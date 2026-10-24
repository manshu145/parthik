import { BusinessRuleError, ConflictError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type {
  PaymentClientPayload,
  PaymentProvider,
  VerifiedWebhookEvent,
} from '@/lib/payments/types';
import type {
  PaymentRecord,
  PaymentRepository,
  PaymentWithOrder,
  RefundRecord,
} from './payment.repository.types';

/**
 * Payment service (docs/ARCHITECTURE.md §11.2, docs/API_SPEC.md §6.3).
 *
 * ONE PRINCIPLE RUNS THROUGH EVERYTHING HERE: **the only trusted source of payment truth is a
 * verified webhook, or the server asking the provider directly.** A browser can report that it
 * paid, and that report is treated as a reason to go and CHECK — never as a state change
 * (docs/SECURITY.md §8.1 rule 2).
 *
 * That is why there is no `markPaid(paymentId)` here. Every path into a settled state carries
 * evidence: `handleWebhook` carries a signed event, `verifyWithProvider` carries a provider
 * snapshot, and both hand it to the repository, which re-checks the amount before writing.
 */

export interface PaymentServiceDeps {
  repository: PaymentRepository;
  provider: PaymentProvider;
}

export type WebhookResult =
  | { status: 'PROCESSED'; kind: VerifiedWebhookEvent['kind']; outcome: string }
  | { status: 'REPLAYED' }
  | { status: 'IGNORED'; reason: string }
  | { status: 'UNPROCESSABLE'; reason: string }
  | { status: 'REJECTED'; reason: 'SIGNATURE_INVALID' | 'NOT_CONFIGURED' | 'STALE' | 'MALFORMED' };

export interface PaymentStatusView {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  status: PaymentRecord['status'];
  amountPaise: number;
  isCod: boolean;
  /** True while the client should keep polling. */
  isPending: boolean;
  failureCode: string | null;
  failureMessage: string | null;
}

export class PaymentService {
  constructor(private readonly deps: PaymentServiceDeps) {}

  /**
   * Creates (or re-creates) the payment intent for an order.
   *
   * Also the RECOVERY path (`POST /api/v1/payments/intent`): a customer whose payment failed
   * comes back to the same order and gets a fresh attempt. The provider idempotency key is the
   * payment row's own key, so a retried request returns the SAME provider order rather than a
   * second one the customer could also pay.
   */
  async createIntent(input: {
    userId: string;
    orderId: string;
  }): Promise<{ payment: PaymentRecord; clientPayload: PaymentClientPayload }> {
    const found = await this.deps.repository.findForOrder(input.orderId);
    if (!found) throw new NotFoundError('That order could not be found.');

    // Ownership checked here rather than in the query, because the lookup is by order and the
    // answer for someone else's order must be the same as for a missing one.
    if (found.order.userId !== input.userId) {
      throw new NotFoundError('That order could not be found.');
    }

    if (found.order.isCod) {
      // Cash has no gateway step. Creating an intent for it would produce a payable link for
      // money that is meant to be collected at the door.
      throw new BusinessRuleError(
        'BUSINESS_RULE_VIOLATED',
        'This order is cash on delivery, so there is nothing to pay online.'
      );
    }

    if (found.payment.status === 'PAID') {
      throw new BusinessRuleError('PAYMENT_ALREADY_CAPTURED', 'This order is already paid.');
    }

    if (found.order.status !== 'PENDING_PAYMENT' && found.order.status !== 'PAYMENT_FAILED') {
      throw new ConflictError('This order is no longer awaiting payment.');
    }

    const result = await this.deps.provider.createIntent({
      orderId: found.order.id,
      orderNumber: found.order.orderNumber,
      amountPaise: found.payment.amountPaise,
      currency: found.payment.currency,
      idempotencyKey: found.payment.idempotencyKey,
    });

    const payment = await this.deps.repository.attachIntent({
      paymentId: found.payment.id,
      providerOrderId: result.providerOrderId,
    });

    logger.info('Payment intent created', {
      paymentId: payment.id,
      orderId: found.order.id,
      provider: this.deps.provider.name,
    });

    return { payment, clientPayload: result.clientPayload };
  }

  /**
   * The status a client may poll (`GET /api/v1/payments/:id/status`).
   *
   * When the payment is still open and the caller offers a provider payment id, the server asks
   * the PROVIDER and settles from that answer. This is what makes a lost webhook self-healing
   * for the customer standing in front of a spinner, without ever trusting what the browser
   * claims happened.
   */
  async getStatusForUser(input: {
    userId: string;
    paymentId: string;
    providerPaymentIdHint?: string | undefined;
  }): Promise<PaymentStatusView> {
    const found = await this.deps.repository.findForUser(input.userId, input.paymentId);
    if (!found) throw new NotFoundError('That payment could not be found.');

    if (isOpen(found.payment.status) && input.providerPaymentIdHint) {
      await this.verifyWithProvider(found, input.providerPaymentIdHint).catch((error: unknown) => {
        // A provider outage must not break the status endpoint: the customer still gets our
        // last known state, and the webhook or the reconciliation job will catch up.
        logger.warn('Could not verify a payment with the provider', {
          paymentId: found.payment.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      const refreshed = await this.deps.repository.findForUser(input.userId, input.paymentId);
      if (refreshed) return toStatusView(refreshed);
    }

    return toStatusView(found);
  }

  /**
   * Asks the provider what really happened and applies it.
   *
   * The three checks below are the whole security of this path. Without the intent check, a
   * customer could present any captured payment id — including somebody else's — and have it
   * confirm their order, because a valid payment for the same amount is easy to come by.
   */
  private async verifyWithProvider(
    found: PaymentWithOrder,
    providerPaymentId: string
  ): Promise<void> {
    const snapshot = await this.deps.provider.fetchPaymentStatus(providerPaymentId);

    // 1. It must belong to the intent we created for THIS order.
    if (
      found.payment.providerOrderId &&
      snapshot.providerOrderId &&
      snapshot.providerOrderId !== found.payment.providerOrderId
    ) {
      logger.warn('A payment reference belonged to a different order', {
        paymentId: found.payment.id,
        providerPaymentId,
      });
      return;
    }

    // 2. It must be settled. An authorised-but-uncaptured payment has moved no money.
    if (snapshot.status !== 'PAID' && snapshot.status !== 'FAILED') return;

    if (snapshot.status === 'FAILED') {
      await this.deps.repository.applyFailure({
        paymentId: found.payment.id,
        providerPaymentId: snapshot.providerPaymentId,
        failureCode: snapshot.failureCode,
        failureMessage: snapshot.failureMessage,
        eventId: null,
      });
      return;
    }

    // 3. The amount is re-checked inside the repository transaction as well; this is the early,
    // cheap refusal.
    const result = await this.deps.repository.applyCapture({
      paymentId: found.payment.id,
      providerPaymentId: snapshot.providerPaymentId,
      amountPaise: snapshot.amountPaise,
      paidAt: snapshot.capturedAt ?? new Date(),
      eventId: null,
    });

    await this.deps.repository.markReconciled(
      found.payment.id,
      `Settled from a provider status check: ${result.outcome}`
    );

    this.escalate(result.outcome, found.payment.id, result.orderId);
  }

  /**
   * Handles a provider webhook (docs/API_SPEC.md §6.3).
   *
   * The ORDER of operations is the contract, and every step exists because of a specific
   * failure:
   *
   *   1. verify the signature over the RAW body — an unsigned body is not evidence
   *   2. store the event under its unique provider id — the replay guard, in the database
   *   3. a duplicate returns immediately — providers retry, and a retry must be free
   *   4. apply the outcome in one transaction — payment, order and stock together
   *
   * Unrecognised event types are STORED and ignored rather than rejected: the log is worth
   * keeping even when the meaning is not, and returning an error would make the provider retry
   * something we will never process.
   */
  async handleWebhook(input: {
    rawBody: string;
    signature: string | null;
    eventId?: string | null;
    now?: Date | undefined;
    /** The provider named in the URL, which must be the one this deployment is configured for. */
    expectedProvider?: string | undefined;
  }): Promise<WebhookResult> {
    /**
     * THE PATH DOES NOT CHOOSE THE VERIFIER.
     *
     * `/webhooks/payments/razorpay` must be verified with Razorpay's secret, not with whichever
     * provider this deployment happens to have active. Without this check, a deployment running
     * the mock gateway would accept a body at the `razorpay` path if it was signed with the
     * MOCK's published development secret — a secret that is, by design, public.
     */
    if (input.expectedProvider && input.expectedProvider !== this.deps.provider.name) {
      logger.warn('A webhook arrived for a provider this deployment is not configured for', {
        requested: input.expectedProvider,
        active: this.deps.provider.name,
      });

      return { status: 'REJECTED', reason: 'NOT_CONFIGURED' };
    }

    const verification = await this.deps.provider.verifyWebhook({
      rawBody: input.rawBody,
      signature: input.signature,
      eventId: input.eventId ?? null,
      now: input.now,
    });

    if (!verification.ok) {
      /**
       * NOTHING IS STORED FOR AN UNVERIFIED BODY, and nothing is parsed from it.
       *
       * Tempting to log the payload for debugging, but an unauthenticated endpoint that writes
       * caller-supplied JSON to the database is a free disk-fill and a log-injection vector. The
       * refusal itself is logged, and a burst of them is the signal worth watching
       * (docs/SECURITY.md §8.2).
       */
      logger.warn('Rejected a payment webhook', {
        provider: this.deps.provider.name,
        reason: verification.reason,
      });

      return { status: 'REJECTED', reason: verification.reason };
    }

    const event = verification.event;
    const linked = await this.locatePayment(event);

    const stored = await this.deps.repository.recordEvent({
      provider: event.provider,
      eventType: event.eventType,
      providerEventId: event.providerEventId,
      rawPayload: event.payload,
      signature: input.signature,
      signatureValid: true,
      paymentId: linked?.payment.id ?? null,
    });

    if (!stored.ok) {
      // The database refused the duplicate. Returning 200 stops a pointless retry loop.
      logger.info('Replayed payment webhook ignored', { providerEventId: event.providerEventId });
      return { status: 'REPLAYED' };
    }

    if (event.kind === 'OTHER') {
      await this.deps.repository.markEventProcessed(stored.eventId, 'event type not handled');
      return { status: 'IGNORED', reason: 'unhandled event type' };
    }

    if (event.kind === 'REFUND_PROCESSED') {
      if (!event.providerRefundId) {
        await this.deps.repository.markEventProcessed(stored.eventId, 'no refund id');
        return { status: 'UNPROCESSABLE', reason: 'the refund event carried no refund id' };
      }

      await this.deps.repository.markRefundStatus(event.providerRefundId, 'COMPLETED');
      await this.deps.repository.markEventProcessed(stored.eventId, null);
      return { status: 'PROCESSED', kind: event.kind, outcome: 'REFUND_COMPLETED' };
    }

    if (!linked) {
      /**
       * A signed event we cannot match to a payment.
       *
       * Stored, and reported as unprocessable with a 200: retrying will not help, and the row
       * is what lets someone work out afterwards whether it was a test event from the
       * dashboard, a payment created outside this system, or a real orphan.
       */
      await this.deps.repository.markEventProcessed(stored.eventId, 'no matching payment');
      logger.warn('Payment webhook did not match any payment', {
        providerEventId: event.providerEventId,
        providerOrderId: event.providerOrderId,
        providerPaymentId: event.providerPaymentId,
      });

      return { status: 'UNPROCESSABLE', reason: 'no matching payment' };
    }

    if (event.kind === 'PAYMENT_AUTHORIZED') {
      // Authorised is not paid: the money is held, not taken. Recorded and left alone, so an
      // order never ships against an uncaptured authorisation.
      await this.deps.repository.markEventProcessed(stored.eventId, null);
      return { status: 'PROCESSED', kind: event.kind, outcome: 'AUTHORIZED_NOT_CAPTURED' };
    }

    if (event.kind === 'PAYMENT_FAILED') {
      const result = await this.deps.repository.applyFailure({
        paymentId: linked.payment.id,
        providerPaymentId: event.providerPaymentId,
        failureCode: event.failureCode,
        failureMessage: event.failureMessage,
        eventId: stored.eventId,
      });

      logger.info('Payment failed', { paymentId: linked.payment.id, outcome: result.outcome });
      return { status: 'PROCESSED', kind: event.kind, outcome: result.outcome };
    }

    if (event.amountPaise === null) {
      await this.deps.repository.markEventProcessed(stored.eventId, 'capture carried no amount');
      return { status: 'UNPROCESSABLE', reason: 'the capture carried no amount' };
    }

    const result = await this.deps.repository.applyCapture({
      paymentId: linked.payment.id,
      providerPaymentId: event.providerPaymentId ?? linked.payment.providerPaymentId ?? 'unknown',
      amountPaise: event.amountPaise,
      paidAt: event.occurredAt ?? new Date(),
      eventId: stored.eventId,
    });

    this.escalate(result.outcome, linked.payment.id, result.orderId);

    return { status: 'PROCESSED', kind: event.kind, outcome: result.outcome };
  }

  /**
   * Reconciliation (docs/ARCHITECTURE.md §11.2): webhooks DO get lost.
   *
   * Without this, a lost webhook means a customer who paid and an order that the unpaid sweep
   * eventually cancels — the single worst outcome the payment path can produce. Only payments
   * that already have a provider reference can be asked about; the rest are the sweep's
   * problem, because there is nothing to ask.
   */
  async reconcileStalePayments(
    input: {
      olderThanMinutes?: number;
      limit?: number;
    } = {}
  ): Promise<{ checked: number; settled: number }> {
    const cutoff = new Date(Date.now() - (input.olderThanMinutes ?? 10) * 60_000);
    const stale = await this.deps.repository.listStalePending(cutoff, input.limit ?? 50);

    let settled = 0;
    let checked = 0;

    for (const candidate of stale) {
      if (!candidate.payment.providerPaymentId && !candidate.payment.providerOrderId) continue;
      if (!candidate.payment.providerPaymentId) {
        // An intent that was never attempted. The unpaid-order sweep releases its stock; there
        // is no payment at the provider to reconcile against.
        continue;
      }

      checked += 1;

      try {
        const before = candidate.payment.status;
        await this.verifyWithProvider(candidate, candidate.payment.providerPaymentId);
        const after = await this.deps.repository.findById(candidate.payment.id);
        if (after && after.payment.status !== before) settled += 1;
      } catch (error) {
        // One unreachable payment must not stop the sweep.
        logger.warn('Could not reconcile a payment', {
          paymentId: candidate.payment.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (settled > 0) logger.info('Reconciled payments the webhook never reported', { settled });
    return { checked, settled };
  }

  /**
   * Refunds an order (`POST /api/v1/admin/orders/:id/refund`).
   *
   * TWO MODES, and the distinction is not cosmetic. A prepaid order is reversed through the
   * gateway. A COD order never had a gateway payment, so there is nothing to reverse: it becomes
   * a MANUAL_PAYOUT record that a human has to approve and pay out (D-15). Reporting both as
   * "refunded" would tell a customer their money is on its way when nobody has been asked to
   * send it.
   */
  async refundOrder(input: {
    orderId: string;
    amountPaise: number;
    reason: string;
    initiatedBy: string | null;
  }): Promise<{ refund: RefundRecord; mode: 'GATEWAY' | 'MANUAL_PAYOUT' }> {
    const found = await this.deps.repository.findForOrder(input.orderId);
    if (!found) throw new NotFoundError('That order could not be found.');

    if (input.amountPaise > found.order.totalAmountPaise) {
      throw new BusinessRuleError(
        'REFUND_EXCEEDS_PAYMENT',
        'A refund cannot be more than the order total.'
      );
    }

    const isManualPayout = found.order.isCod || found.payment.status !== 'PAID';

    if (isManualPayout) {
      const recorded = await this.deps.repository.createRefund({
        orderId: input.orderId,
        // No payment id: linking a manual payout to a gateway payment that does not exist would
        // make reconciliation report money returned through a channel it never used.
        paymentId: null,
        amountPaise: input.amountPaise,
        reason: input.reason,
        initiatedBy: input.initiatedBy,
        providerRefundId: null,
        status: 'INITIATED',
        isManualPayout: true,
      });

      if (!recorded.ok) {
        throw new BusinessRuleError(
          'REFUND_EXCEEDS_PAYMENT',
          'That would refund more than this order was worth.'
        );
      }

      logger.info('Manual payout recorded', {
        orderId: input.orderId,
        amountPaise: input.amountPaise,
      });

      return { refund: recorded.refund, mode: 'MANUAL_PAYOUT' };
    }

    if (!found.payment.providerPaymentId) {
      throw new ConflictError('This payment has no gateway reference to refund against.');
    }

    /**
     * The RECORD IS WRITTEN FIRST, before the gateway call.
     *
     * Deliberate ordering. If the gateway succeeds and our write then fails, we have refunded
     * money with no record of it — and the next attempt would refund again. Writing first means
     * the worst case is a recorded refund that never went out, which a status check finds and a
     * human can retry.
     */
    const recorded = await this.deps.repository.createRefund({
      orderId: input.orderId,
      paymentId: found.payment.id,
      amountPaise: input.amountPaise,
      reason: input.reason,
      initiatedBy: input.initiatedBy,
      providerRefundId: null,
      status: 'INITIATED',
      isManualPayout: false,
    });

    if (!recorded.ok) {
      throw new BusinessRuleError(
        'REFUND_EXCEEDS_PAYMENT',
        'That would refund more than was captured for this order.'
      );
    }

    const result = await this.deps.provider.refund({
      providerPaymentId: found.payment.providerPaymentId,
      amountPaise: input.amountPaise,
      // Derived from the refund row, so a retry of the same refund is recognised by the gateway.
      idempotencyKey: `refund:${recorded.refund.id}`,
      notes: { orderNumber: found.order.orderNumber },
    });

    await this.deps.repository.markRefundStatus(result.providerRefundId, result.status);

    logger.info('Refund submitted to the gateway', {
      orderId: input.orderId,
      refundId: recorded.refund.id,
      status: result.status,
    });

    return {
      refund: { ...recorded.refund, providerRefundId: result.providerRefundId },
      mode: 'GATEWAY',
    };
  }

  /** Whether this environment can take a prepaid payment at all. */
  isPrepaidAvailable(): boolean {
    return this.deps.provider.isConfigured();
  }

  /**
   * Finds the payment an event refers to.
   *
   * By provider ORDER id first, because that is the reference we created and stored ourselves.
   * The provider PAYMENT id is only known to us after a previous event, so it is the fallback
   * rather than the primary key.
   */
  private async locatePayment(event: VerifiedWebhookEvent): Promise<PaymentWithOrder | null> {
    if (event.providerOrderId) {
      const byOrder = await this.deps.repository.findByProviderOrderId(event.providerOrderId);
      if (byOrder) return byOrder;
    }

    if (event.providerPaymentId) {
      return this.deps.repository.findByProviderPaymentId(event.providerPaymentId);
    }

    return null;
  }

  /**
   * Shouts about the outcomes a human has to deal with.
   *
   * `PAID_AFTER_CANCELLATION` and `AMOUNT_MISMATCH` are both states where money and records
   * disagree. Logging them at ERROR is what turns them into an alert rather than a customer
   * complaint three days later.
   */
  private escalate(outcome: string, paymentId: string, orderId: string): void {
    if (outcome === 'PAID_AFTER_CANCELLATION') {
      logger.error('A payment was captured for an order that had already been cancelled', {
        paymentId,
        orderId,
        action: 'a refund is owed',
      });
      return;
    }

    if (outcome === 'AMOUNT_MISMATCH') {
      logger.error('A payment webhook reported an amount that does not match the order', {
        paymentId,
        orderId,
        action: 'nothing was marked paid; investigate before confirming',
      });
      return;
    }

    if (outcome === 'PAID_WITHOUT_TRANSITION') {
      logger.warn('A payment was captured for an order that had already moved on', {
        paymentId,
        orderId,
      });
    }
  }
}

function isOpen(status: PaymentRecord['status']): boolean {
  return status === 'CREATED' || status === 'PENDING' || status === 'AUTHORIZED';
}

function toStatusView(found: PaymentWithOrder): PaymentStatusView {
  return {
    paymentId: found.payment.id,
    orderId: found.order.id,
    orderNumber: found.order.orderNumber,
    status: found.payment.status,
    amountPaise: found.payment.amountPaise,
    isCod: found.order.isCod,
    isPending: isOpen(found.payment.status),
    failureCode: found.payment.failureCode,
    // The gateway's own wording is kept out of the customer's view; the code is enough for the
    // UI to choose copy, and provider messages routinely name internal account state.
    failureMessage: found.payment.failureMessage,
  };
}

export function createPaymentService(deps: PaymentServiceDeps): PaymentService {
  return new PaymentService(deps);
}
