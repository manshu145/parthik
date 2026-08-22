import { and, asc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { orders, paymentEvents, payments, refunds } from '@/db/schema';
import type { Database } from '@/lib/db/client';
import type { RepositoryContext } from '@/lib/db/repository';
import { ConflictError, NotFoundError } from '@/lib/errors';
import type { ProviderPaymentStatus, ProviderRefundStatus } from '@/lib/payments/types';
import { applyOrderTransitionInTx, requireTransition, type OrderStatus } from '@/modules/order';
import type {
  ApplyCaptureInput,
  ApplyFailureInput,
  CaptureOutcome,
  CreateRefundInput,
  FailureOutcome,
  PaymentMethod,
  PaymentRecord,
  PaymentRepository,
  PaymentWithOrder,
  RecordEventInput,
  RecordEventResult,
  RefundRecord,
} from './payment.repository.types';

/**
 * Drizzle payment repository.
 *
 * THE ONE THING TO UNDERSTAND HERE: a payment outcome and the order it belongs to are written
 * in a SINGLE transaction. `applyCapture` marks the payment PAID, sets the order's payment
 * status, moves the order out of PENDING_PAYMENT through the state machine, writes the history
 * row, and marks the webhook event processed — all or nothing.
 *
 * The alternative, two transactions in sequence, fails in the worst possible place: a crash
 * between them leaves a customer charged for an order that still looks unpaid, which the
 * unpaid-order sweep will then cancel (docs/API_SPEC.md §6.3 step 5).
 */
export class DrizzlePaymentRepository implements PaymentRepository {
  private readonly db: Database;

  constructor(context: RepositoryContext) {
    this.db = context.db;
  }

  async findForOrder(orderId: string): Promise<PaymentWithOrder | null> {
    return this.findOne(eq(payments.orderId, orderId));
  }

  async findById(paymentId: string): Promise<PaymentWithOrder | null> {
    return this.findOne(eq(payments.id, paymentId));
  }

  async findForUser(userId: string, paymentId: string): Promise<PaymentWithOrder | null> {
    // Ownership is part of the WHERE clause, so another customer's payment id is
    // indistinguishable from one that does not exist.
    return this.findOne(and(eq(payments.id, paymentId), eq(orders.userId, userId)));
  }

  async findByProviderOrderId(providerOrderId: string): Promise<PaymentWithOrder | null> {
    return this.findOne(eq(payments.providerOrderId, providerOrderId));
  }

  async findByProviderPaymentId(providerPaymentId: string): Promise<PaymentWithOrder | null> {
    return this.findOne(eq(payments.providerPaymentId, providerPaymentId));
  }

  async attachIntent(input: {
    paymentId: string;
    providerOrderId: string;
  }): Promise<PaymentRecord> {
    const [updated] = await this.db
      .update(payments)
      .set({
        providerOrderId: input.providerOrderId,
        // CREATED means "we have a row"; PENDING means "the customer has somewhere to pay".
        status: 'PENDING',
        // Cleared so a retry does not show the customer the previous decline reason as if it
        // were the state of the new attempt.
        failureCode: null,
        failureMessage: null,
        failedAt: null,
        updatedAt: new Date(),
      })
      /**
       * FAILED is included, and that is the recovery path.
       *
       * A declined card is the most common reason a customer comes back, and the state machine
       * explicitly allows PAYMENT_FAILED -> CONFIRMED on a retried payment. Only PAID is
       * excluded: a second intent on a captured payment would give the customer a way to pay
       * twice.
       */
      .where(
        and(
          eq(payments.id, input.paymentId),
          inArray(payments.status, ['CREATED', 'PENDING', 'FAILED'])
        )
      )
      .returning(paymentColumns);

    if (!updated) {
      throw new ConflictError('This payment can no longer accept a new attempt.');
    }

    return mapPayment(updated);
  }

  async recordEvent(input: RecordEventInput): Promise<RecordEventResult> {
    /**
     * `onConflictDoNothing` on the unique `provider_event_id`.
     *
     * The database is the replay guard, not a preceding SELECT. Two concurrent deliveries of
     * the same event would both pass a read-then-write check; exactly one can win an insert.
     */
    const [inserted] = await this.db
      .insert(paymentEvents)
      .values({
        paymentId: input.paymentId,
        provider: input.provider,
        eventType: input.eventType,
        providerEventId: input.providerEventId,
        rawPayload: input.rawPayload,
        signature: input.signature,
        signatureValid: input.signatureValid,
      })
      .onConflictDoNothing({ target: paymentEvents.providerEventId })
      .returning({ id: paymentEvents.id });

    if (inserted) return { ok: true, eventId: inserted.id };

    const [existing] = await this.db
      .select({ id: paymentEvents.id })
      .from(paymentEvents)
      .where(eq(paymentEvents.providerEventId, input.providerEventId))
      .limit(1);

    return { ok: false, reason: 'DUPLICATE', eventId: existing?.id ?? null };
  }

  async markEventProcessed(eventId: string, error?: string | null): Promise<void> {
    await this.db
      .update(paymentEvents)
      .set({ processedAt: new Date(), processingError: error ?? null })
      .where(eq(paymentEvents.id, eventId));
  }

  async applyCapture(
    input: ApplyCaptureInput
  ): Promise<{ outcome: CaptureOutcome; orderId: string }> {
    return this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select({
          id: payments.id,
          orderId: payments.orderId,
          amountPaise: payments.amountPaise,
          status: payments.status,
          authorizedAt: payments.authorizedAt,
        })
        .from(payments)
        .where(eq(payments.id, input.paymentId))
        // Locked so two deliveries of the same capture serialise here rather than both
        // deciding the payment was unpaid.
        .for('update')
        .limit(1);

      if (!payment) throw new NotFoundError('That payment could not be found.');

      if (payment.status === 'PAID') {
        // Idempotent. A retried webhook is a normal event, not a fault.
        if (input.eventId) await markProcessed(tx, input.eventId, null);
        return { outcome: 'ALREADY_PAID' as const, orderId: payment.orderId };
      }

      /**
       * AMOUNT CHECK BEFORE ANY WRITE.
       *
       * A capture for less than the order total is either a partial capture or a forged
       * payload, and neither may confirm the order. Recorded on the event and reported, but
       * nothing is marked paid — a human decides (docs/SECURITY.md §8.1).
       */
      if (Number(payment.amountPaise) !== input.amountPaise) {
        if (input.eventId) {
          await markProcessed(
            tx,
            input.eventId,
            `amount mismatch: provider ${input.amountPaise}, expected ${payment.amountPaise}`
          );
        }
        return { outcome: 'AMOUNT_MISMATCH' as const, orderId: payment.orderId };
      }

      await tx
        .update(payments)
        .set({
          status: 'PAID',
          providerPaymentId: input.providerPaymentId,
          paidAt: input.paidAt,
          /**
           * Capture implies authorisation, and some flows never send the authorised event.
           *
           * Resolved in JS from the row we already hold under lock, NOT with
           * `coalesce(authorized_at, $1)` in a raw `sql` template: drizzle cannot know the
           * column type inside a raw fragment, so it hands the driver a bare JS Date and
           * Postgres rejects the statement. That typechecks perfectly and fails only at
           * runtime, against a real database.
           */
          authorizedAt: payment.authorizedAt ?? input.paidAt,
          failureCode: null,
          failureMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id));

      const [order] = await tx
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(eq(orders.id, payment.orderId))
        .for('update')
        .limit(1);

      if (!order) throw new NotFoundError('That order could not be found.');

      await tx
        .update(orders)
        .set({ paymentStatus: 'PAID', updatedAt: new Date() })
        .where(eq(orders.id, order.id));

      const status = order.status as OrderStatus;

      /**
       * PAYMENT_FAILED is a legal starting point, not an error.
       *
       * It is the recovery case the state machine names explicitly: an earlier attempt failed,
       * the customer retried, and this capture confirms the order. The transition carries
       * RESERVE_STOCK, because the failure gave the units back.
       */
      if (status === 'PENDING_PAYMENT' || status === 'PAYMENT_FAILED') {
        // The state machine decides the effects; this file does not get to choose them.
        const rule = requireTransition(status, 'CONFIRMED', 'SYSTEM');

        await applyOrderTransitionInTx(tx, {
          orderId: order.id,
          from: status,
          to: 'CONFIRMED',
          actor: 'SYSTEM',
          actorUserId: null,
          reason: 'Payment captured',
          effects: rule.effects,
        });

        if (input.eventId) await markProcessed(tx, input.eventId, null);
        return { outcome: 'CONFIRMED' as const, orderId: order.id };
      }

      /**
       * The order moved on without us.
       *
       * CANCELLED is the dangerous one: the unpaid sweep released the stock and closed the
       * order, and now the money has arrived anyway. The payment stays PAID because that is
       * the truth, and the caller escalates — a refund is owed.
       */
      const outcome: CaptureOutcome =
        status === 'CANCELLED' ? 'PAID_AFTER_CANCELLATION' : 'PAID_WITHOUT_TRANSITION';

      if (input.eventId) await markProcessed(tx, input.eventId, `order was ${status}`);
      return { outcome, orderId: order.id };
    });
  }

  async applyFailure(
    input: ApplyFailureInput
  ): Promise<{ outcome: FailureOutcome; orderId: string }> {
    return this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select({ id: payments.id, orderId: payments.orderId, status: payments.status })
        .from(payments)
        .where(eq(payments.id, input.paymentId))
        .for('update')
        .limit(1);

      if (!payment) throw new NotFoundError('That payment could not be found.');

      if (payment.status === 'PAID') {
        /**
         * A failure event arriving after a capture must NOT undo the capture.
         *
         * Razorpay can deliver `payment.failed` for an earlier attempt on the same order after
         * a later attempt succeeded. Treating that as a failure would release stock for an
         * order the customer has paid for.
         */
        if (input.eventId) await markProcessed(tx, input.eventId, 'payment already captured');
        return { outcome: 'ALREADY_PAID' as const, orderId: payment.orderId };
      }

      if (payment.status === 'FAILED') {
        if (input.eventId) await markProcessed(tx, input.eventId, null);
        return { outcome: 'ALREADY_FAILED' as const, orderId: payment.orderId };
      }

      const now = new Date();

      await tx
        .update(payments)
        .set({
          status: 'FAILED',
          ...(input.providerPaymentId ? { providerPaymentId: input.providerPaymentId } : {}),
          failureCode: input.failureCode,
          failureMessage: input.failureMessage,
          failedAt: now,
          updatedAt: now,
        })
        .where(eq(payments.id, payment.id));

      const [order] = await tx
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(eq(orders.id, payment.orderId))
        .for('update')
        .limit(1);

      if (!order) throw new NotFoundError('That order could not be found.');

      await tx
        .update(orders)
        .set({ paymentStatus: 'FAILED', updatedAt: now })
        .where(eq(orders.id, order.id));

      if ((order.status as OrderStatus) !== 'PENDING_PAYMENT') {
        // Already cancelled, or already moved on. Its stock was released by whatever moved it.
        if (input.eventId) await markProcessed(tx, input.eventId, `order was ${order.status}`);
        return { outcome: 'NO_TRANSITION' as const, orderId: order.id };
      }

      // RELEASE_STOCK and RELEASE_COUPON come from the transition table: stock is freed the
      // moment payment fails, because holding it strangles availability for everyone else.
      const rule = requireTransition('PENDING_PAYMENT', 'PAYMENT_FAILED', 'SYSTEM');

      await applyOrderTransitionInTx(tx, {
        orderId: order.id,
        from: 'PENDING_PAYMENT',
        to: 'PAYMENT_FAILED',
        actor: 'SYSTEM',
        actorUserId: null,
        reason: input.failureMessage ?? 'Payment failed',
        effects: rule.effects,
      });

      if (input.eventId) await markProcessed(tx, input.eventId, null);
      return { outcome: 'PAYMENT_FAILED' as const, orderId: order.id };
    });
  }

  async listStalePending(before: Date, limit: number): Promise<PaymentWithOrder[]> {
    const rows = await this.db
      .select({ payment: paymentColumns, order: orderColumns })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      // Matches the partial index `payments_reconciliation_idx`.
      .where(and(inArray(payments.status, ['CREATED', 'PENDING']), lt(payments.createdAt, before)))
      .orderBy(asc(payments.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      payment: mapPayment(row.payment),
      order: mapOrderFacts(row.order),
    }));
  }

  async markReconciled(paymentId: string, note: string): Promise<void> {
    await this.db
      .update(payments)
      .set({ reconciledAt: new Date(), reconciliationNote: note, updatedAt: new Date() })
      .where(eq(payments.id, paymentId));
  }

  async refundedTotalPaise(orderId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${refunds.amountPaise}), 0)` })
      .from(refunds)
      // A FAILED refund never moved money, so it must not count against the ceiling — the
      // customer would be permanently short by that amount.
      .where(
        and(
          eq(refunds.orderId, orderId),
          inArray(refunds.status, ['INITIATED', 'PROCESSING', 'COMPLETED'])
        )
      )
      .limit(1);

    return Number(row?.total ?? 0);
  }

  async createRefund(
    input: CreateRefundInput
  ): Promise<{ ok: true; refund: RefundRecord } | { ok: false; reason: 'EXCEEDS_PAYMENT' }> {
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select({ id: orders.id, totalAmountPaise: orders.totalAmountPaise })
        .from(orders)
        .where(eq(orders.id, input.orderId))
        // Locked so two concurrent refunds cannot each read the same "already refunded" total
        // and both pass the ceiling check.
        .for('update')
        .limit(1);

      if (!order) throw new NotFoundError('That order could not be found.');

      const [sum] = await tx
        .select({ total: sql<string>`coalesce(sum(${refunds.amountPaise}), 0)` })
        .from(refunds)
        .where(
          and(
            eq(refunds.orderId, input.orderId),
            inArray(refunds.status, ['INITIATED', 'PROCESSING', 'COMPLETED'])
          )
        );

      const alreadyRefunded = Number(sum?.total ?? 0);
      const ceiling = Number(order.totalAmountPaise);

      /**
       * THE CEILING IS ABSOLUTE.
       *
       * A refund that exceeds what was paid is money leaving the business with no
       * corresponding receipt. Enforced here rather than in the service so no caller can skip
       * it (docs/SECURITY.md §8.1 rule 4).
       */
      if (alreadyRefunded + input.amountPaise > ceiling) {
        return { ok: false as const, reason: 'EXCEEDS_PAYMENT' as const };
      }

      const [created] = await tx
        .insert(refunds)
        .values({
          orderId: input.orderId,
          paymentId: input.paymentId,
          providerRefundId: input.providerRefundId,
          amountPaise: input.amountPaise,
          reason: input.reason,
          refundType: alreadyRefunded + input.amountPaise >= ceiling ? 'FULL' : 'PARTIAL',
          status: input.status,
          initiatedBy: input.initiatedBy,
          // A manual payout has to be approved by a person before cash leaves a drawer, so it
          // is recorded with no approver rather than as approved-by-default (D-15).
          notes: input.isManualPayout
            ? 'Manual payout: cash on delivery has no gateway payment to reverse.'
            : null,
        })
        .returning({
          id: refunds.id,
          orderId: refunds.orderId,
          paymentId: refunds.paymentId,
          providerRefundId: refunds.providerRefundId,
          amountPaise: refunds.amountPaise,
          status: refunds.status,
          refundType: refunds.refundType,
          createdAt: refunds.createdAt,
        });

      if (!created) throw new ConflictError('Could not record the refund.');

      const [orderRow] = await tx
        .select({ paymentStatus: orders.paymentStatus })
        .from(orders)
        .where(eq(orders.id, input.orderId))
        .limit(1);

      // The order's payment status reflects how much came back, so a report does not have to
      // re-sum the refunds table to answer "was this refunded?".
      if (orderRow) {
        await tx
          .update(orders)
          .set({
            paymentStatus:
              alreadyRefunded + input.amountPaise >= ceiling ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
            updatedAt: new Date(),
          })
          .where(eq(orders.id, input.orderId));
      }

      return {
        ok: true as const,
        refund: {
          id: created.id,
          orderId: created.orderId,
          paymentId: created.paymentId,
          providerRefundId: created.providerRefundId,
          amountPaise: Number(created.amountPaise),
          status: created.status as ProviderRefundStatus,
          refundType: created.refundType as 'FULL' | 'PARTIAL',
          createdAt: created.createdAt,
        },
      };
    });
  }

  async markRefundStatus(providerRefundId: string, status: ProviderRefundStatus): Promise<void> {
    await this.db
      .update(refunds)
      .set({
        status,
        ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(refunds.providerRefundId, providerRefundId));
  }

  private async findOne(where: SQL | undefined): Promise<PaymentWithOrder | null> {
    const [row] = await this.db
      .select({ payment: paymentColumns, order: orderColumns })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(where)
      .limit(1);

    return row ? { payment: mapPayment(row.payment), order: mapOrderFacts(row.order) } : null;
  }
}

const paymentColumns = {
  id: payments.id,
  orderId: payments.orderId,
  provider: payments.provider,
  providerPaymentId: payments.providerPaymentId,
  providerOrderId: payments.providerOrderId,
  method: payments.method,
  amountPaise: payments.amountPaise,
  currency: payments.currency,
  status: payments.status,
  idempotencyKey: payments.idempotencyKey,
  failureCode: payments.failureCode,
  failureMessage: payments.failureMessage,
  authorizedAt: payments.authorizedAt,
  paidAt: payments.paidAt,
  failedAt: payments.failedAt,
  reconciledAt: payments.reconciledAt,
  createdAt: payments.createdAt,
} as const;

const orderColumns = {
  id: orders.id,
  orderNumber: orders.orderNumber,
  userId: orders.userId,
  status: orders.status,
  totalAmountPaise: orders.totalAmountPaise,
  isCod: orders.isCod,
  paymentStatus: orders.paymentStatus,
} as const;

type PaymentRow = { [K in keyof typeof paymentColumns]: unknown };

function mapPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id as string,
    orderId: row.orderId as string,
    provider: row.provider as string,
    providerPaymentId: (row.providerPaymentId as string | null) ?? null,
    providerOrderId: (row.providerOrderId as string | null) ?? null,
    method: row.method as PaymentMethod,
    // `numeric`/`bigint` columns come back as strings from the driver, and `"45900" + 100`
    // is a string concatenation bug waiting to be a wrong total.
    amountPaise: Number(row.amountPaise),
    currency: row.currency as string,
    status: row.status as ProviderPaymentStatus,
    idempotencyKey: row.idempotencyKey as string,
    failureCode: (row.failureCode as string | null) ?? null,
    failureMessage: (row.failureMessage as string | null) ?? null,
    authorizedAt: (row.authorizedAt as Date | null) ?? null,
    paidAt: (row.paidAt as Date | null) ?? null,
    failedAt: (row.failedAt as Date | null) ?? null,
    reconciledAt: (row.reconciledAt as Date | null) ?? null,
    createdAt: row.createdAt as Date,
  };
}

function mapOrderFacts(row: { [K in keyof typeof orderColumns]: unknown }) {
  return {
    id: row.id as string,
    orderNumber: row.orderNumber as string,
    userId: row.userId as string,
    status: row.status as OrderStatus,
    totalAmountPaise: Number(row.totalAmountPaise),
    isCod: row.isCod as boolean,
    paymentStatus: row.paymentStatus as string,
  };
}

/** Inside a transaction, so the event's processed marker commits with the outcome. */
async function markProcessed(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  eventId: string,
  error: string | null
): Promise<void> {
  await tx
    .update(paymentEvents)
    .set({ processedAt: new Date(), processingError: error })
    .where(eq(paymentEvents.id, eventId));
}

export function createPaymentRepository(context: RepositoryContext): PaymentRepository {
  return new DrizzlePaymentRepository(context);
}
