import type { OrderStatus, TransitionActor, TransitionEffect } from './order.state';

/**
 * Order repository contract.
 *
 * The signatures here are shaped by one constraint: ORDER CREATION IS ONE TRANSACTION.
 * The order, its lines, the first history row, the stock reservation, the payment row and
 * the coupon redemption either all exist or none do. Exposing them as separate methods
 * would let a caller commit half an order, and a half-committed order is one that has taken
 * stock without a payment to pay for it.
 */

export type PaymentMethod = 'UPI' | 'CARD' | 'COD';

/** A line as it will be FROZEN onto the order. */
export interface OrderLineInput {
  productId: string;
  variantId: string;
  /** Snapshots — a later rename or reprice must not alter a historical order. */
  productNameSnapshot: string;
  variantLabelSnapshot: string | null;
  imageKeySnapshot: string | null;
  unitLabelSnapshot: string | null;
  skuSnapshot: string | null;
  quantity: number;
  mrpPaise: number;
  unitPricePaise: number;
  itemDiscountPaise: number;
  lineTotalPaise: number;
}

export interface CreateOrderInput {
  userId: string;
  storeId: string;
  vendorId: string;
  deliveryZoneId: string | null;

  /** Frozen copy, so the order survives the address being edited or deleted. */
  deliveryAddressSnapshot: Record<string, unknown>;
  contactName: string;
  contactPhone: string;

  lines: OrderLineInput[];

  grossAmountPaise: number;
  itemDiscountPaise: number;
  couponId: string | null;
  couponCodeSnapshot: string | null;
  couponDiscountPaise: number;
  deliveryFeePaise: number;
  packagingFeePaise: number;
  serviceFeePaise: number;
  totalAmountPaise: number;

  paymentMethod: PaymentMethod;
  estimatedDeliveryAt: Date | null;
  customerNote: string | null;

  /** Makes a repeated click or a network retry safe (master spec §12). */
  idempotencyKey: string;
  source: 'WEB' | 'PWA' | 'ADMIN';
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  userId: string;
  storeId: string;
  vendorId: string;
  status: OrderStatus;
  deliveryAddressSnapshot: Record<string, unknown>;
  contactName: string;
  contactPhone: string;
  deliveryZoneId: string | null;

  grossAmountPaise: number;
  itemDiscountPaise: number;
  couponCodeSnapshot: string | null;
  couponDiscountPaise: number;
  taxableAmountPaise: number;
  /** Always 0 while D-14 is blocked. */
  taxAmountPaise: number;
  deliveryFeePaise: number;
  packagingFeePaise: number;
  serviceFeePaise: number;
  totalAmountPaise: number;

  paymentMethod: PaymentMethod;
  paymentStatus: string;
  isCod: boolean;
  codAmountPaise: number | null;

  placedAt: Date | null;
  confirmedAt: Date | null;
  acceptedAt: Date | null;
  readyAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  cancelledByRole: string | null;
  estimatedDeliveryAt: Date | null;
  customerNote: string | null;
  createdAt: Date;
}

export interface OrderLineRecord {
  id: string;
  productId: string | null;
  variantId: string | null;
  productNameSnapshot: string;
  variantLabelSnapshot: string | null;
  imageKeySnapshot: string | null;
  unitLabelSnapshot: string | null;
  quantity: number;
  mrpPaise: number;
  unitPricePaise: number;
  itemDiscountPaise: number;
  lineTotalPaise: number;
}

export interface OrderStatusEvent {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedByRole: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface OrderDetail {
  order: OrderRecord;
  lines: OrderLineRecord[];
  timeline: OrderStatusEvent[];
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmountPaise: number;
  itemCount: number;
  /** First line's image, for the list thumbnail. */
  thumbnailKey: string | null;
  firstItemName: string;
  createdAt: Date;
  isCod: boolean;
}

export interface TransitionInput {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  actor: TransitionActor;
  actorUserId: string | null;
  reason: string | null;
  effects: readonly TransitionEffect[];
  /** Set when the transition marks a COD payment collected. */
  codCollectedPaise?: number | null;
}

/**
 * The stock a reservation could not satisfy.
 *
 * Returned rather than thrown from the repository so the SERVICE decides the error, keeping
 * the documented `INSUFFICIENT_STOCK` shape (with the available quantity) in one place.
 */
export interface StockShortfall {
  variantId: string;
  requested: number;
  available: number;
}

export interface OrderRepository {
  /**
   * Creates the order and everything that must exist with it, atomically.
   *
   * Returns a shortfall instead of an order when stock ran out between the quote and the
   * commit. That window is real and unavoidable — the quote is a read, the reservation is a
   * write, and another customer can buy the last unit in between — so the reservation
   * happens under `SELECT … FOR UPDATE` and this is how the loser is told.
   */
  create(
    input: CreateOrderInput
  ): Promise<{ ok: true; order: OrderRecord } | { ok: false; shortfalls: StockShortfall[] }>;

  /** An order the given user owns. Scoped in the query, like every other read. */
  findForUser(userId: string, orderId: string): Promise<OrderDetail | null>;

  /** Looked up by the human reference, for support. */
  findByOrderNumber(orderNumber: string): Promise<OrderDetail | null>;

  /** Any order, for admin and for internal transitions. */
  findById(orderId: string): Promise<OrderDetail | null>;

  listForUser(
    userId: string,
    page: { limit: number; cursor?: string | undefined }
  ): Promise<{
    items: OrderListItem[];
    nextCursor: string | null;
  }>;

  /**
   * Applies a validated transition and its effects in ONE transaction.
   *
   * The state machine has already decided the move is legal; this performs it — the status
   * change, the history row, the timestamp, the stock movement and the COD ledger entry
   * together. Splitting them would allow an order marked DELIVERED whose stock was never
   * consumed.
   */
  applyTransition(input: TransitionInput): Promise<OrderRecord>;

  /**
   * Orders stuck awaiting payment past the cutoff.
   *
   * Feeds the sweep that releases their stock (D-16). Without it, abandoned checkouts would
   * hold inventory indefinitely and silently strangle availability.
   */
  listExpiredPendingPayment(before: Date, limit: number): Promise<OrderRecord[]>;

  /** Replays a completed request for the same idempotency key. */
  findByIdempotencyKey(key: string): Promise<OrderRecord | null>;
}
