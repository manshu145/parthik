import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  couponUsages,
  inventory,
  inventoryTransactions,
  orderItems,
  orderStatusHistory,
  orders,
  payments,
} from '@/db/schema';
import type { Database } from '@/lib/db/client';
import type { RepositoryContext } from '@/lib/db/repository';
import { ConflictError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type {
  CreateOrderInput,
  OrderDetail,
  OrderLineRecord,
  OrderListItem,
  OrderRecord,
  OrderRepository,
  OrderStatusEvent,
  PaymentMethod,
  StockShortfall,
  TransitionInput,
} from './order.repository.types';
import { STATUS_TIMESTAMP_COLUMN, type OrderStatus } from './order.state';

/** Any transaction handle, so helpers work inside and outside a transaction. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Drizzle order repository.
 *
 * THE ONE THING TO UNDERSTAND HERE: order creation is a single transaction that also
 * RESERVES STOCK under a row lock. Everything else follows from that.
 *
 * Reservation must be pessimistic. Between the checkout quote (a read) and the insert (a
 * write) another customer can buy the last unit, so `SELECT … FOR UPDATE` serialises
 * contending checkouts on the inventory row and the loser gets a shortfall rather than an
 * oversell. The database additionally holds a `quantity_available >= 0` check constraint, so
 * overselling is impossible rather than merely unlikely (docs/DATABASE.md §6.1).
 */
export class DrizzleOrderRepository implements OrderRepository {
  private readonly db: Database;

  constructor(context: RepositoryContext) {
    this.db = context.db;
  }

  async create(
    input: CreateOrderInput
  ): Promise<{ ok: true; order: OrderRecord } | { ok: false; shortfalls: StockShortfall[] }> {
    const isCod = input.paymentMethod === 'COD';

    /**
     * Entry status depends on the payment method (D-12).
     *
     * Prepaid waits for a verified webhook. COD has no upstream payment to wait for, so it
     * is CONFIRMED immediately and its `payments` row sits at PENDING until cash is
     * collected at the door.
     */
    const initialStatus: OrderStatus = isCod ? 'CONFIRMED' : 'PENDING_PAYMENT';
    const now = new Date();

    return this.db.transaction(async (tx) => {
      // ---- 1. Reserve stock FIRST, under a row lock ----
      //
      // Before the order row exists, so a failed reservation costs nothing and leaves no
      // order behind. Ordered by variant id to give every concurrent checkout the same lock
      // order, which is what prevents two carts sharing two variants from deadlocking.
      const shortfalls = await reserveStock(tx, {
        storeId: input.storeId,
        lines: input.lines,
      });

      if (shortfalls.length > 0) {
        // Rolls back the locks taken above.
        return { ok: false as const, shortfalls };
      }

      // ---- 2. The order ----
      const orderNumber = await nextOrderNumber(tx);

      const [created] = await tx
        .insert(orders)
        .values({
          orderNumber,
          userId: input.userId,
          storeId: input.storeId,
          vendorId: input.vendorId,
          status: initialStatus,
          deliveryAddressSnapshot: input.deliveryAddressSnapshot,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          deliveryZoneId: input.deliveryZoneId,

          grossAmountPaise: input.grossAmountPaise,
          itemDiscountPaise: input.itemDiscountPaise,
          couponId: input.couponId,
          couponCodeSnapshot: input.couponCodeSnapshot,
          couponDiscountPaise: input.couponDiscountPaise,

          /**
           * 🔴 D-14 BLOCKED. Both written as 0, and `taxable_amount` is the full taxable
           * base with no tax applied. No rate is inferred from category or price, and no
           * inclusive/exclusive assumption is coded (docs/ARCHITECTURE.md §11.2.2).
           */
          taxableAmountPaise: 0,
          taxAmountPaise: 0,

          deliveryFeePaise: input.deliveryFeePaise,
          packagingFeePaise: input.packagingFeePaise,
          serviceFeePaise: input.serviceFeePaise,
          totalAmountPaise: input.totalAmountPaise,

          paymentMethod: input.paymentMethod,
          paymentStatus: isCod ? 'PENDING' : 'CREATED',
          isCod,
          // The check constraint `orders_cod_amount_consistent` enforces this pairing, so a
          // prepaid order can never carry an amount to collect.
          codAmountPaise: isCod ? input.totalAmountPaise : null,

          placedAt: now,
          confirmedAt: isCod ? now : null,
          estimatedDeliveryAt: input.estimatedDeliveryAt,
          customerNote: input.customerNote,

          idempotencyKey: input.idempotencyKey,
          source: input.source,
        })
        .returning(orderColumns);

      if (!created) throw new ConflictError('Could not create the order.');

      // ---- 3. Lines, fully snapshotted ----
      await tx.insert(orderItems).values(
        input.lines.map((line) => ({
          orderId: created.id,
          productId: line.productId,
          variantId: line.variantId,
          productNameSnapshot: line.productNameSnapshot,
          variantLabelSnapshot: line.variantLabelSnapshot,
          imageKeySnapshot: line.imageKeySnapshot,
          unitLabelSnapshot: line.unitLabelSnapshot,
          skuSnapshot: line.skuSnapshot,
          // D-14: captured for a future invoice, currently null.
          hsnSnapshot: null,
          quantity: line.quantity,
          mrpPaise: line.mrpPaise,
          unitPricePaise: line.unitPricePaise,
          itemDiscountPaise: line.itemDiscountPaise,
          taxRate: null,
          taxAmountPaise: 0,
          lineTotalPaise: line.lineTotalPaise,
        }))
      );

      // ---- 4. The first history row ----
      //
      // `from_status` is null because there is no prior status. Every transition without
      // exception gets a row (master spec §13), and that includes the first one.
      await tx.insert(orderStatusHistory).values({
        orderId: created.id,
        fromStatus: null,
        toStatus: initialStatus,
        changedByUserId: input.userId,
        changedByRole: 'CUSTOMER',
        reason: 'Order placed',
      });

      // ---- 5. The payment row ----
      //
      // Created for COD too, deliberately: cash is still a payment and needs a row to
      // reconcile against, or COD orders would be invisible to every payment report.
      await tx.insert(payments).values({
        orderId: created.id,
        provider: isCod ? 'cod' : 'razorpay',
        method: input.paymentMethod,
        amountPaise: input.totalAmountPaise,
        status: isCod ? 'PENDING' : 'CREATED',
        // Derived from the order's key so a retried checkout cannot create a second payment.
        idempotencyKey: `${input.idempotencyKey}:payment`,
      });

      // ---- 6. Coupon redemption ----
      //
      // Recorded inside the transaction so the per-user limit is race-safe: the unique index
      // on (coupon_id, order_id) plus this atomicity is what makes the limit enforced rather
      // than advisory (docs/DATABASE.md §6).
      if (input.couponId) {
        await tx.insert(couponUsages).values({
          couponId: input.couponId,
          userId: input.userId,
          orderId: created.id,
          discountAppliedPaise: input.couponDiscountPaise,
        });
      }

      // ---- 7. Link the stock movements to the order ----
      //
      // Written after the order exists so `reference_id` is a real order id. The ledger is
      // what makes current stock reproducible, so a movement with no reference would be
      // unattributable.
      await tx
        .update(inventoryTransactions)
        .set({ referenceId: created.id })
        .where(
          and(
            eq(inventoryTransactions.referenceType, 'ORDER'),
            sql`${inventoryTransactions.referenceId} is null`,
            inArray(
              inventoryTransactions.variantId,
              input.lines.map((line) => line.variantId)
            )
          )
        );

      return { ok: true as const, order: mapOrder(created) };
    });
  }

  async findForUser(userId: string, orderId: string): Promise<OrderDetail | null> {
    const [order] = await this.db
      .select(orderColumns)
      .from(orders)
      // Ownership is part of the lookup, so another customer's order id resolves to null
      // rather than leaking that it exists.
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
      .limit(1);

    return order ? this.hydrate(order) : null;
  }

  async findById(orderId: string): Promise<OrderDetail | null> {
    const [order] = await this.db
      .select(orderColumns)
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    return order ? this.hydrate(order) : null;
  }

  async findByOrderNumber(orderNumber: string): Promise<OrderDetail | null> {
    const [order] = await this.db
      .select(orderColumns)
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1);

    return order ? this.hydrate(order) : null;
  }

  async findByIdempotencyKey(key: string): Promise<OrderRecord | null> {
    const [order] = await this.db
      .select(orderColumns)
      .from(orders)
      .where(eq(orders.idempotencyKey, key))
      .limit(1);

    return order ? mapOrder(order) : null;
  }

  async listForUser(
    userId: string,
    page: { limit: number; cursor?: string | undefined }
  ): Promise<{ items: OrderListItem[]; nextCursor: string | null }> {
    // Keyset pagination on created_at, matching `orders_user_idx`. Offset pagination would
    // shift rows under the customer as new orders arrive.
    const cursorDate = page.cursor ? new Date(page.cursor) : null;

    const rows = await this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        totalAmountPaise: orders.totalAmountPaise,
        isCod: orders.isCod,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        cursorDate
          ? and(eq(orders.userId, userId), lt(orders.createdAt, cursorDate))
          : eq(orders.userId, userId)
      )
      .orderBy(desc(orders.createdAt))
      // One extra row tells us whether another page exists without a second count query.
      .limit(page.limit + 1);

    const hasMore = rows.length > page.limit;
    const pageRows = hasMore ? rows.slice(0, page.limit) : rows;

    /**
     * The line summary comes from a SECOND query, not a correlated subquery.
     *
     * ⚠️ Drizzle renders a column inside a raw `sql` template UNQUALIFIED when the outer
     * query has a single table in its FROM clause. A correlated subquery written as
     * `where ${orderItems.orderId} = ${orders.id}` therefore emits
     * `where "order_id" = "id"` — both resolved against `order_items` — which is valid
     * SQL that silently matches nothing. It typechecks, it runs, and every count comes
     * back 0. Two plain queries cannot express that bug.
     *
     * The cost is one extra round trip over `order_items_order_idx` for at most `limit`
     * ids, and the summary is folded in memory over a few dozen rows.
     */
    const summaries = new Map<
      string,
      { itemCount: number; name: string; imageKey: string | null }
    >();

    if (pageRows.length > 0) {
      const lines = await this.db
        .select({
          orderId: orderItems.orderId,
          quantity: orderItems.quantity,
          productNameSnapshot: orderItems.productNameSnapshot,
          imageKeySnapshot: orderItems.imageKeySnapshot,
        })
        .from(orderItems)
        .where(
          inArray(
            orderItems.orderId,
            pageRows.map((row) => row.id)
          )
        )
        // Oldest line first, so the first row for an order is the one shown on the card.
        .orderBy(orderItems.orderId, orderItems.createdAt);

      for (const line of lines) {
        const existing = summaries.get(line.orderId);
        if (existing) {
          existing.itemCount += line.quantity;
        } else {
          summaries.set(line.orderId, {
            itemCount: line.quantity,
            name: line.productNameSnapshot,
            imageKey: line.imageKeySnapshot,
          });
        }
      }
    }

    const items = pageRows.map((row) => {
      const summary = summaries.get(row.id);
      return {
        id: row.id,
        orderNumber: row.orderNumber,
        status: row.status as OrderStatus,
        totalAmountPaise: Number(row.totalAmountPaise),
        itemCount: summary?.itemCount ?? 0,
        thumbnailKey: summary?.imageKey ?? null,
        firstItemName: summary?.name ?? '',
        createdAt: row.createdAt,
        isCod: row.isCod,
      };
    });

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null,
    };
  }

  async listForVendor(
    vendorId: string,
    page: { limit: number; cursor?: string | undefined; statuses?: readonly OrderStatus[] }
  ): Promise<{ items: OrderListItem[]; nextCursor: string | null }> {
    const cursorDate = page.cursor ? new Date(page.cursor) : null;

    const rows = await this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        totalAmountPaise: orders.totalAmountPaise,
        isCod: orders.isCod,
        createdAt: orders.createdAt,
      })
      .from(orders)
      // Matches `orders_vendor_idx`.
      .where(
        and(
          eq(orders.vendorId, vendorId),
          ...(page.statuses && page.statuses.length > 0
            ? [inArray(orders.status, [...page.statuses])]
            : []),
          ...(cursorDate ? [lt(orders.createdAt, cursorDate)] : [])
        )
      )
      .orderBy(desc(orders.createdAt))
      .limit(page.limit + 1);

    const hasMore = rows.length > page.limit;
    const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
    const summaries = await this.lineSummaries(pageRows.map((row) => row.id));

    const items = pageRows.map((row) => {
      const summary = summaries.get(row.id);
      return {
        id: row.id,
        orderNumber: row.orderNumber,
        status: row.status as OrderStatus,
        totalAmountPaise: Number(row.totalAmountPaise),
        itemCount: summary?.itemCount ?? 0,
        thumbnailKey: summary?.imageKey ?? null,
        firstItemName: summary?.name ?? '',
        createdAt: row.createdAt,
        isCod: row.isCod,
      };
    });

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null,
    };
  }

  /**
   * Line summaries for a page of orders, in one indexed query.
   *
   * Shared by the customer list and the vendor queue. NOT a correlated subquery: drizzle renders
   * columns unqualified inside a raw `sql` template when the outer query has one FROM table, so
   * `where ${orderItems.orderId} = ${orders.id}` silently compares two `order_items` columns and
   * every count comes back 0 (docs/DATABASE.md §15.1).
   */
  private async lineSummaries(
    orderIds: string[]
  ): Promise<Map<string, { itemCount: number; name: string; imageKey: string | null }>> {
    const summaries = new Map<
      string,
      { itemCount: number; name: string; imageKey: string | null }
    >();
    if (orderIds.length === 0) return summaries;

    const lines = await this.db
      .select({
        orderId: orderItems.orderId,
        quantity: orderItems.quantity,
        productNameSnapshot: orderItems.productNameSnapshot,
        imageKeySnapshot: orderItems.imageKeySnapshot,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))
      .orderBy(orderItems.orderId, orderItems.createdAt);

    for (const line of lines) {
      const existing = summaries.get(line.orderId);
      if (existing) {
        existing.itemCount += line.quantity;
      } else {
        summaries.set(line.orderId, {
          itemCount: line.quantity,
          name: line.productNameSnapshot,
          imageKey: line.imageKeySnapshot,
        });
      }
    }

    return summaries;
  }

  async applyTransition(input: TransitionInput): Promise<OrderRecord> {
    return this.db.transaction((tx) => applyOrderTransitionInTx(tx, input));
  }

  async listExpiredPendingPayment(before: Date, limit: number): Promise<OrderRecord[]> {
    const rows = await this.db
      .select(orderColumns)
      .from(orders)
      // Matches the partial index `orders_pending_payment_idx`.
      .where(and(eq(orders.status, 'PENDING_PAYMENT'), lt(orders.createdAt, before)))
      .orderBy(orders.createdAt)
      .limit(limit);

    return rows.map(mapOrder);
  }

  private async hydrate(order: OrderRow): Promise<OrderDetail> {
    const [lines, timeline] = await Promise.all([
      this.db
        .select({
          id: orderItems.id,
          productId: orderItems.productId,
          variantId: orderItems.variantId,
          productNameSnapshot: orderItems.productNameSnapshot,
          variantLabelSnapshot: orderItems.variantLabelSnapshot,
          imageKeySnapshot: orderItems.imageKeySnapshot,
          unitLabelSnapshot: orderItems.unitLabelSnapshot,
          quantity: orderItems.quantity,
          mrpPaise: orderItems.mrpPaise,
          unitPricePaise: orderItems.unitPricePaise,
          itemDiscountPaise: orderItems.itemDiscountPaise,
          lineTotalPaise: orderItems.lineTotalPaise,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id))
        .orderBy(orderItems.createdAt),

      this.db
        .select({
          id: orderStatusHistory.id,
          fromStatus: orderStatusHistory.fromStatus,
          toStatus: orderStatusHistory.toStatus,
          changedByRole: orderStatusHistory.changedByRole,
          reason: orderStatusHistory.reason,
          createdAt: orderStatusHistory.createdAt,
        })
        .from(orderStatusHistory)
        .where(eq(orderStatusHistory.orderId, order.id))
        .orderBy(orderStatusHistory.createdAt),
    ]);

    return {
      order: mapOrder(order),
      lines: lines.map((line): OrderLineRecord => ({
        ...line,
        mrpPaise: Number(line.mrpPaise),
        unitPricePaise: Number(line.unitPricePaise),
        itemDiscountPaise: Number(line.itemDiscountPaise),
        lineTotalPaise: Number(line.lineTotalPaise),
      })),
      timeline: timeline.map((event): OrderStatusEvent => ({
        id: event.id,
        fromStatus: event.fromStatus as OrderStatus | null,
        toStatus: event.toStatus as OrderStatus,
        changedByRole: event.changedByRole,
        reason: event.reason,
        createdAt: event.createdAt,
      })),
    };
  }
}

/**
 * Applies a validated transition INSIDE A CALLER'S TRANSACTION.
 *
 * Extracted from `applyTransition` so another module can move an order in the SAME
 * transaction as its own write. The payment module needs exactly that: a captured webhook has
 * to mark the payment PAID and confirm the order atomically, because a crash between two
 * separate transactions would leave a customer charged for an order still sitting in
 * PENDING_PAYMENT (docs/API_SPEC.md §6.3 step 5).
 *
 * Exposed through `modules/order/index.ts` rather than by importing this file, because a
 * repository must not import another module's repository. Everything that does not need to
 * share a transaction should use `OrderService.transition()` instead, which also validates the
 * move against the state machine — this function trusts the effects it is handed.
 */
export async function applyOrderTransitionInTx(
  tx: Tx,
  input: TransitionInput
): Promise<OrderRecord> {
  /**
   * Re-read the order under a row lock and CHECK THE STATUS AGAIN.
   *
   * The service already validated the transition, but it read the order outside this
   * transaction. Two vendors clicking "accept" simultaneously would both pass that check;
   * only one may pass this one. Without it the second write would silently overwrite the
   * first and the history would show an impossible sequence.
   */
  const [current] = await tx
    .select({ id: orders.id, status: orders.status, isCod: orders.isCod })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .for('update')
    .limit(1);

  if (!current) throw new ConflictError('That order no longer exists.');

  if (current.status !== input.from) {
    throw new ConflictError(
      `This order has already moved to ${current.status}. Please reload and try again.`
    );
  }

  const now = new Date();
  const timestampColumn = STATUS_TIMESTAMP_COLUMN[input.to];

  const [updated] = await tx
    .update(orders)
    .set({
      status: input.to,
      ...(timestampColumn ? { [timestampColumn]: now } : {}),
      ...(input.to === 'CANCELLED'
        ? { cancellationReason: input.reason, cancelledByRole: input.actor }
        : {}),
      // COD becomes PAID only here, in the same transaction as the cash ledger entry.
      ...(input.effects.includes('COLLECT_COD') && current.isCod
        ? { paymentStatus: 'PAID' as const }
        : {}),
      version: sql`${orders.version} + 1`,
      updatedAt: now,
    })
    .where(eq(orders.id, input.orderId))
    .returning(orderColumns);

  if (!updated) throw new ConflictError('Could not update the order.');

  // Every transition, without exception (master spec §13).
  await tx.insert(orderStatusHistory).values({
    orderId: input.orderId,
    fromStatus: input.from,
    toStatus: input.to,
    changedByUserId: input.actorUserId,
    changedByRole: input.actor,
    reason: input.reason,
  });

  // ---- Stock effects ----
  const lines = await tx
    .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, input.orderId));

  const storeId = await storeIdOf(tx, input.orderId);

  if (input.effects.includes('RELEASE_STOCK')) {
    await releaseStock(tx, { orderId: input.orderId, storeId, lines });
  }

  if (input.effects.includes('CONSUME_STOCK')) {
    await consumeStock(tx, { orderId: input.orderId, storeId, lines });
  }

  /**
   * RESERVE_STOCK — failed-payment recovery only.
   *
   * The failure released these units, so a retried payment has to take them again.
   *
   * Recorded as an ADJUSTMENT, not as a second RESERVE, and that is forced by the schema:
   * `inventory_transactions_order_movement_key` is unique on
   * (reference_id, variant_id, txn_type), which is exactly what makes RESERVE and RELEASE
   * idempotent for an order. A second RESERVE row is therefore impossible — and trying was a
   * unique-violation that aborted the whole capture. The ADJUSTMENT carries the order
   * reference and a reason, so stock stays reproducible from the ledger, and the same unique
   * index makes the re-reservation idempotent in its turn.
   *
   * A shortfall does NOT abort the transaction. The money has already been captured by the
   * time this runs, and throwing here would roll the capture back and leave the provider
   * retrying forever — so what is available is taken, and the gap is reported at ERROR.
   */
  if (input.effects.includes('RESERVE_STOCK')) {
    const shortfalls = await reReserveStock(tx, {
      orderId: input.orderId,
      storeId,
      lines,
    });

    if (shortfalls.length > 0) {
      logger.error('An order was confirmed but its stock could not be fully re-reserved', {
        orderId: input.orderId,
        shortfalls,
        action: 'contact the customer: fulfil short or refund',
      });
    }
  }

  // ---- COD payment ----
  if (input.effects.includes('COLLECT_COD') && current.isCod) {
    await tx
      .update(payments)
      .set({ status: 'PAID', paidAt: now })
      .where(and(eq(payments.orderId, input.orderId), eq(payments.method, 'COD')));
  }

  // ---- Coupon release ----
  //
  // Deleting the redemption is what returns the coupon to the customer's allowance. The
  // unique index means a re-order can then record it again.
  if (input.effects.includes('RELEASE_COUPON')) {
    await tx.delete(couponUsages).where(eq(couponUsages.orderId, input.orderId));
  }

  return mapOrder(updated);
}

// ---------------------------------------------------------------------------
// Stock movements
// ---------------------------------------------------------------------------

/**
 * Reserves stock for every line, or reports what could not be satisfied.
 *
 * `SELECT … FOR UPDATE` ordered by variant id. The lock is what makes this safe under
 * concurrency, and the consistent ordering is what stops two carts sharing two variants
 * from deadlocking against each other.
 *
 * `track_inventory = false` lines skip reservation entirely but still record a movement, so
 * reporting sees them (docs/DATABASE.md §6.1 rule 7).
 */
async function reserveStock(
  tx: Tx,
  input: { storeId: string; lines: Array<{ variantId: string; quantity: number }> }
): Promise<StockShortfall[]> {
  const shortfalls: StockShortfall[] = [];

  const ordered = [...input.lines].sort((a, b) => a.variantId.localeCompare(b.variantId));

  for (const line of ordered) {
    const [row] = await tx
      .select({
        id: inventory.id,
        quantityAvailable: inventory.quantityAvailable,
        trackInventory: inventory.trackInventory,
        allowBackorder: inventory.allowBackorder,
      })
      .from(inventory)
      .where(eq(inventory.variantId, line.variantId))
      .for('update')
      .limit(1);

    // No inventory row means stock is not tracked for this variant. Treated as available
    // rather than as zero: a missing row is a catalogue gap, not an out-of-stock signal, and
    // refusing the sale would be the wrong default for an untracked item.
    if (!row) continue;

    if (row.trackInventory && !row.allowBackorder && row.quantityAvailable < line.quantity) {
      shortfalls.push({
        variantId: line.variantId,
        requested: line.quantity,
        available: row.quantityAvailable,
      });
      continue;
    }

    if (row.trackInventory) {
      await tx
        .update(inventory)
        .set({
          quantityAvailable: sql`${inventory.quantityAvailable} - ${line.quantity}`,
          quantityReserved: sql`${inventory.quantityReserved} + ${line.quantity}`,
          version: sql`${inventory.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(inventory.id, row.id));
    }

    await tx.insert(inventoryTransactions).values({
      variantId: line.variantId,
      storeId: input.storeId,
      txnType: 'RESERVE',
      quantityDelta: -line.quantity,
      quantityAfter: row.trackInventory
        ? row.quantityAvailable - line.quantity
        : row.quantityAvailable,
      referenceType: 'ORDER',
      // Filled in once the order row exists.
      referenceId: null,
      reason: 'Reserved at order creation',
    });
  }

  return shortfalls;
}

/**
 * Returns reserved units to sellable stock.
 *
 * IDEMPOTENT by `(order_id, RELEASE)`: a retried cancellation or a duplicated queue message
 * must not release the same stock twice and inflate inventory (docs/DATABASE.md §6.1 rule 4).
 */
async function releaseStock(
  tx: Tx,
  input: {
    orderId: string;
    storeId: string;
    lines: Array<{ variantId: string | null; quantity: number }>;
  }
): Promise<void> {
  const [existing] = await tx
    .select({ id: inventoryTransactions.id })
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.referenceType, 'ORDER'),
        eq(inventoryTransactions.referenceId, input.orderId),
        eq(inventoryTransactions.txnType, 'RELEASE')
      )
    )
    .limit(1);

  if (existing) return;

  for (const line of input.lines) {
    if (!line.variantId) continue;

    const [row] = await tx
      .select({
        id: inventory.id,
        quantityAvailable: inventory.quantityAvailable,
        trackInventory: inventory.trackInventory,
      })
      .from(inventory)
      .where(eq(inventory.variantId, line.variantId))
      .for('update')
      .limit(1);

    if (!row?.trackInventory) continue;

    await tx
      .update(inventory)
      .set({
        quantityAvailable: sql`${inventory.quantityAvailable} + ${line.quantity}`,
        // `greatest(0, …)` guards the counter against ever going negative if a reservation
        // was already consumed by another path.
        quantityReserved: sql`greatest(0, ${inventory.quantityReserved} - ${line.quantity})`,
        version: sql`${inventory.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(inventory.id, row.id));

    await tx.insert(inventoryTransactions).values({
      variantId: line.variantId,
      storeId: input.storeId,
      txnType: 'RELEASE',
      quantityDelta: line.quantity,
      quantityAfter: row.quantityAvailable + line.quantity,
      referenceType: 'ORDER',
      referenceId: input.orderId,
      reason: 'Released on cancellation',
    });
  }
}

/**
 * Converts a reservation into a sale.
 *
 * `quantity_available` is UNCHANGED — it was already decremented at reservation. Only the
 * reserved counter falls (docs/DATABASE.md §6.1). Decrementing available again here is the
 * obvious mistake, and it would double-count every sale.
 */
async function consumeStock(
  tx: Tx,
  input: {
    orderId: string;
    storeId: string;
    lines: Array<{ variantId: string | null; quantity: number }>;
  }
): Promise<void> {
  const [existing] = await tx
    .select({ id: inventoryTransactions.id })
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.referenceType, 'ORDER'),
        eq(inventoryTransactions.referenceId, input.orderId),
        eq(inventoryTransactions.txnType, 'SALE')
      )
    )
    .limit(1);

  if (existing) return;

  for (const line of input.lines) {
    if (!line.variantId) continue;

    const [row] = await tx
      .select({
        id: inventory.id,
        quantityAvailable: inventory.quantityAvailable,
        trackInventory: inventory.trackInventory,
      })
      .from(inventory)
      .where(eq(inventory.variantId, line.variantId))
      .for('update')
      .limit(1);

    if (row?.trackInventory) {
      await tx
        .update(inventory)
        .set({
          quantityReserved: sql`greatest(0, ${inventory.quantityReserved} - ${line.quantity})`,
          version: sql`${inventory.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(inventory.id, row.id));
    }

    await tx.insert(inventoryTransactions).values({
      variantId: line.variantId,
      storeId: input.storeId,
      txnType: 'SALE',
      quantityDelta: 0,
      quantityAfter: row?.quantityAvailable ?? 0,
      referenceType: 'ORDER',
      referenceId: input.orderId,
      reason: 'Sold on delivery',
    });
  }
}

/**
 * Takes a reservation BACK after a payment failure released it.
 *
 * IDEMPOTENT on the existence of the ADJUSTMENT row: a replayed transition must not remove the
 * same units twice. Written as an ADJUSTMENT because the unique index that makes RESERVE
 * idempotent for an order also makes a second RESERVE row impossible.
 */
async function reReserveStock(
  tx: Tx,
  input: {
    orderId: string;
    storeId: string;
    lines: Array<{ variantId: string | null; quantity: number }>;
  }
): Promise<StockShortfall[]> {
  const [existing] = await tx
    .select({ id: inventoryTransactions.id })
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.referenceType, 'ORDER'),
        eq(inventoryTransactions.referenceId, input.orderId),
        eq(inventoryTransactions.txnType, 'ADJUSTMENT')
      )
    )
    .limit(1);

  if (existing) return [];

  const shortfalls: StockShortfall[] = [];
  // Same lock order as `reserveStock`, so a recovery and a fresh checkout cannot deadlock.
  const ordered = [...input.lines]
    .flatMap((line) =>
      line.variantId ? [{ variantId: line.variantId, quantity: line.quantity }] : []
    )
    .sort((a, b) => a.variantId.localeCompare(b.variantId));

  for (const line of ordered) {
    const [row] = await tx
      .select({
        id: inventory.id,
        quantityAvailable: inventory.quantityAvailable,
        trackInventory: inventory.trackInventory,
        allowBackorder: inventory.allowBackorder,
      })
      .from(inventory)
      .where(eq(inventory.variantId, line.variantId))
      .for('update')
      .limit(1);

    if (!row) continue;

    if (row.trackInventory && !row.allowBackorder && row.quantityAvailable < line.quantity) {
      shortfalls.push({
        variantId: line.variantId,
        requested: line.quantity,
        available: row.quantityAvailable,
      });
      continue;
    }

    if (row.trackInventory) {
      await tx
        .update(inventory)
        .set({
          quantityAvailable: sql`${inventory.quantityAvailable} - ${line.quantity}`,
          quantityReserved: sql`${inventory.quantityReserved} + ${line.quantity}`,
          version: sql`${inventory.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(inventory.id, row.id));
    }

    await tx.insert(inventoryTransactions).values({
      variantId: line.variantId,
      storeId: input.storeId,
      txnType: 'ADJUSTMENT',
      quantityDelta: -line.quantity,
      quantityAfter: row.trackInventory
        ? row.quantityAvailable - line.quantity
        : row.quantityAvailable,
      referenceType: 'ORDER',
      // Attributable immediately: the order already exists by the time a recovery happens.
      referenceId: input.orderId,
      reason: 'Re-reserved after failed-payment recovery',
    });
  }

  return shortfalls;
}

async function storeIdOf(tx: Tx, orderId: string): Promise<string> {
  const [row] = await tx
    .select({ storeId: orders.storeId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) throw new ConflictError('That order no longer exists.');
  return row.storeId;
}

/**
 * Next human-readable order number, e.g. `PK-2026-000123`.
 *
 * From a sequence, not a count. A count would race: two concurrent checkouts would read the
 * same value and collide on `orders_number_key`, failing one for no reason the customer
 * could understand.
 */
async function nextOrderNumber(tx: Tx): Promise<string> {
  const result = await tx.execute<{ value: string }>(
    sql`select nextval('order_number_seq')::text as value`
  );

  const rows = result as unknown as Array<{ value: string }>;
  const value = Number(rows[0]?.value ?? 0);

  return `PK-${new Date().getFullYear()}-${String(value).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

const orderColumns = {
  id: orders.id,
  orderNumber: orders.orderNumber,
  userId: orders.userId,
  storeId: orders.storeId,
  vendorId: orders.vendorId,
  status: orders.status,
  deliveryAddressSnapshot: orders.deliveryAddressSnapshot,
  contactName: orders.contactName,
  contactPhone: orders.contactPhone,
  deliveryZoneId: orders.deliveryZoneId,
  grossAmountPaise: orders.grossAmountPaise,
  itemDiscountPaise: orders.itemDiscountPaise,
  couponCodeSnapshot: orders.couponCodeSnapshot,
  couponDiscountPaise: orders.couponDiscountPaise,
  taxableAmountPaise: orders.taxableAmountPaise,
  taxAmountPaise: orders.taxAmountPaise,
  deliveryFeePaise: orders.deliveryFeePaise,
  packagingFeePaise: orders.packagingFeePaise,
  serviceFeePaise: orders.serviceFeePaise,
  totalAmountPaise: orders.totalAmountPaise,
  paymentMethod: orders.paymentMethod,
  paymentStatus: orders.paymentStatus,
  isCod: orders.isCod,
  codAmountPaise: orders.codAmountPaise,
  placedAt: orders.placedAt,
  confirmedAt: orders.confirmedAt,
  acceptedAt: orders.acceptedAt,
  readyAt: orders.readyAt,
  deliveredAt: orders.deliveredAt,
  cancelledAt: orders.cancelledAt,
  cancellationReason: orders.cancellationReason,
  cancelledByRole: orders.cancelledByRole,
  estimatedDeliveryAt: orders.estimatedDeliveryAt,
  customerNote: orders.customerNote,
  createdAt: orders.createdAt,
} as const;

type OrderRow = {
  [K in keyof typeof orderColumns]: unknown;
} & { id: string; createdAt: Date };

function mapOrder(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    orderNumber: String(row.orderNumber),
    userId: String(row.userId),
    storeId: String(row.storeId),
    vendorId: String(row.vendorId),
    status: row.status as OrderStatus,
    deliveryAddressSnapshot: (row.deliveryAddressSnapshot ?? {}) as Record<string, unknown>,
    contactName: String(row.contactName),
    contactPhone: String(row.contactPhone),
    deliveryZoneId: (row.deliveryZoneId as string | null) ?? null,
    grossAmountPaise: Number(row.grossAmountPaise),
    itemDiscountPaise: Number(row.itemDiscountPaise),
    couponCodeSnapshot: (row.couponCodeSnapshot as string | null) ?? null,
    couponDiscountPaise: Number(row.couponDiscountPaise),
    taxableAmountPaise: Number(row.taxableAmountPaise),
    taxAmountPaise: Number(row.taxAmountPaise),
    deliveryFeePaise: Number(row.deliveryFeePaise),
    packagingFeePaise: Number(row.packagingFeePaise),
    serviceFeePaise: Number(row.serviceFeePaise),
    totalAmountPaise: Number(row.totalAmountPaise),
    paymentMethod: row.paymentMethod as PaymentMethod,
    paymentStatus: String(row.paymentStatus),
    isCod: Boolean(row.isCod),
    codAmountPaise: row.codAmountPaise === null ? null : Number(row.codAmountPaise),
    placedAt: (row.placedAt as Date | null) ?? null,
    confirmedAt: (row.confirmedAt as Date | null) ?? null,
    acceptedAt: (row.acceptedAt as Date | null) ?? null,
    readyAt: (row.readyAt as Date | null) ?? null,
    deliveredAt: (row.deliveredAt as Date | null) ?? null,
    cancelledAt: (row.cancelledAt as Date | null) ?? null,
    cancellationReason: (row.cancellationReason as string | null) ?? null,
    cancelledByRole: (row.cancelledByRole as string | null) ?? null,
    estimatedDeliveryAt: (row.estimatedDeliveryAt as Date | null) ?? null,
    customerNote: (row.customerNote as string | null) ?? null,
    createdAt: row.createdAt,
  };
}

export function createOrderRepository(context: RepositoryContext): OrderRepository {
  return new DrizzleOrderRepository(context);
}
