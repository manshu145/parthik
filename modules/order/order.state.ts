import { StateTransitionError } from '@/lib/errors';

/**
 * The order state machine (master spec §13, docs/DATABASE.md §7.1).
 *
 * An EXPLICIT TABLE, not a set of conditionals. Anything absent from it is refused, which
 * is the difference between "we did not think about that transition" and "that transition
 * is forbidden" — with scattered `if` statements those two look identical, and the second
 * one is the only safe default for money.
 *
 * Each entry also declares the SIDE EFFECTS the transition requires. That is why the table
 * exists rather than a plain adjacency list: an order reaching DELIVERED must convert its
 * stock reservation to a sale and must notify the customer, and declaring those next to the
 * transition is what stops a new code path advancing the status while forgetting one.
 */

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'PAYMENT_FAILED'
  | 'REFUNDED'
  | 'RETURNED'
  | 'FAILED_DELIVERY';

/** Who may trigger a transition. `SYSTEM` covers webhooks and cron. */
export type TransitionActor = 'CUSTOMER' | 'VENDOR' | 'DRIVER' | 'ADMIN' | 'SYSTEM';

/**
 * Effects a transition must perform, declared alongside it.
 *
 * `RELEASE_STOCK` and `CONSUME_STOCK` are mutually exclusive by construction: stock is
 * either returned to the shelf or converted to a sale, never both, and a transition that
 * claimed both would be a bug the type system cannot catch — so the table is the record.
 */
export type TransitionEffect =
  /** Return reserved units to sellable stock (D-16). */
  | 'RELEASE_STOCK'
  /**
   * Take the reservation BACK, for failed-payment recovery.
   *
   * A payment failure releases the stock immediately, so an order that later succeeds on a
   * retry has nothing held for it. Without this the order would confirm against inventory it
   * never reserved, and the sale would be deducted from a reservation that does not exist.
   */
  | 'RESERVE_STOCK'
  /** Convert the reservation to a sale. Only on delivery. */
  | 'CONSUME_STOCK'
  /** Mark the COD payment PAID and write the driver cash ledger entry. */
  | 'COLLECT_COD'
  /** Release the coupon redemption so the customer may use it again. */
  | 'RELEASE_COUPON'
  /** Notify the customer of the new status. */
  | 'NOTIFY_CUSTOMER'
  /** Notify the vendor. */
  | 'NOTIFY_VENDOR'
  /** Hand the order to dispatch (D-18). */
  | 'REQUEST_DISPATCH'
  /** A refund becomes payable. Amount comes from the cancellation policy. */
  | 'REFUND_DUE';

export interface TransitionRule {
  to: OrderStatus;
  /** Roles permitted to make this transition. */
  actors: readonly TransitionActor[];
  effects: readonly TransitionEffect[];
  /** Recorded on `order_status_history` and shown on the timeline. */
  requiresReason?: boolean;
}

/**
 * Every legal transition.
 *
 * Terminal states (DELIVERED beyond returns, REFUNDED, RETURNED) have no outgoing entries
 * except the ones listed, so they cannot be reopened by an ordinary code path.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly TransitionRule[]>> = {
  /**
   * Prepaid entry point. Only a VERIFIED webhook advances it (master spec §22) — the
   * browser telling us it paid is not evidence, so CUSTOMER is absent from `CONFIRMED`.
   */
  PENDING_PAYMENT: [
    { to: 'CONFIRMED', actors: ['SYSTEM'], effects: ['NOTIFY_CUSTOMER', 'NOTIFY_VENDOR'] },
    {
      to: 'PAYMENT_FAILED',
      actors: ['SYSTEM'],
      // Stock is freed the moment payment fails; holding it would strangle availability
      // for everyone else (D-16).
      effects: ['RELEASE_STOCK', 'RELEASE_COUPON', 'NOTIFY_CUSTOMER'],
    },
    {
      to: 'CANCELLED',
      // SYSTEM covers the unpaid-timeout sweep; the customer may also abandon.
      actors: ['CUSTOMER', 'SYSTEM', 'ADMIN'],
      effects: ['RELEASE_STOCK', 'RELEASE_COUPON', 'NOTIFY_CUSTOMER'],
    },
  ],

  /** COD orders are created here directly: there is no upstream payment to wait for. */
  CONFIRMED: [
    { to: 'ACCEPTED', actors: ['VENDOR', 'ADMIN'], effects: ['NOTIFY_CUSTOMER'] },
    {
      to: 'CANCELLED',
      actors: ['CUSTOMER', 'VENDOR', 'ADMIN'],
      effects: ['RELEASE_STOCK', 'RELEASE_COUPON', 'REFUND_DUE', 'NOTIFY_CUSTOMER'],
      requiresReason: true,
    },
  ],

  ACCEPTED: [
    { to: 'PREPARING', actors: ['VENDOR', 'ADMIN'], effects: ['NOTIFY_CUSTOMER'] },
    {
      to: 'CANCELLED',
      actors: ['VENDOR', 'ADMIN'],
      effects: ['RELEASE_STOCK', 'RELEASE_COUPON', 'REFUND_DUE', 'NOTIFY_CUSTOMER'],
      requiresReason: true,
    },
  ],

  PREPARING: [
    {
      to: 'READY_FOR_PICKUP',
      actors: ['VENDOR', 'ADMIN'],
      // Dispatch begins here, not at ACCEPTED: offering a delivery before the food exists
      // wastes the driver's time and the offer window.
      effects: ['REQUEST_DISPATCH', 'NOTIFY_CUSTOMER'],
    },
    {
      to: 'CANCELLED',
      actors: ['VENDOR', 'ADMIN'],
      effects: ['RELEASE_STOCK', 'RELEASE_COUPON', 'REFUND_DUE', 'NOTIFY_CUSTOMER'],
      requiresReason: true,
    },
  ],

  READY_FOR_PICKUP: [
    { to: 'ASSIGNED', actors: ['SYSTEM', 'ADMIN'], effects: ['NOTIFY_CUSTOMER'] },
    {
      to: 'CANCELLED',
      actors: ['ADMIN'],
      effects: ['RELEASE_STOCK', 'RELEASE_COUPON', 'REFUND_DUE', 'NOTIFY_CUSTOMER'],
      requiresReason: true,
    },
  ],

  ASSIGNED: [
    { to: 'PICKED_UP', actors: ['DRIVER', 'ADMIN'], effects: ['NOTIFY_CUSTOMER'] },
    {
      // A driver who drops the job returns the order to the dispatch pool rather than
      // cancelling it — the customer's order is still valid.
      to: 'READY_FOR_PICKUP',
      actors: ['DRIVER', 'ADMIN'],
      effects: ['REQUEST_DISPATCH'],
      requiresReason: true,
    },
    {
      to: 'CANCELLED',
      actors: ['ADMIN'],
      effects: ['RELEASE_STOCK', 'RELEASE_COUPON', 'REFUND_DUE', 'NOTIFY_CUSTOMER'],
      requiresReason: true,
    },
  ],

  PICKED_UP: [
    { to: 'OUT_FOR_DELIVERY', actors: ['DRIVER', 'ADMIN'], effects: ['NOTIFY_CUSTOMER'] },
    {
      to: 'FAILED_DELIVERY',
      actors: ['DRIVER', 'ADMIN'],
      effects: ['NOTIFY_CUSTOMER'],
      requiresReason: true,
    },
  ],

  OUT_FOR_DELIVERY: [
    {
      to: 'DELIVERED',
      actors: ['DRIVER', 'ADMIN'],
      /**
       * The only transition that consumes stock. Requires the delivery OTP (D-20), and for
       * COD also a confirmed collected amount — `COLLECT_COD` writes the cash ledger in the
       * SAME transaction, so cash recorded as collected and a payment marked paid can never
       * diverge.
       */
      effects: ['CONSUME_STOCK', 'COLLECT_COD', 'NOTIFY_CUSTOMER', 'NOTIFY_VENDOR'],
    },
    {
      to: 'FAILED_DELIVERY',
      actors: ['DRIVER', 'ADMIN'],
      effects: ['NOTIFY_CUSTOMER'],
      requiresReason: true,
    },
  ],

  /** Post-delivery outcomes are ADMIN only: the money has already moved. */
  DELIVERED: [
    {
      to: 'RETURNED',
      actors: ['ADMIN'],
      effects: ['RELEASE_STOCK', 'REFUND_DUE', 'NOTIFY_CUSTOMER'],
      requiresReason: true,
    },
    { to: 'REFUNDED', actors: ['ADMIN'], effects: ['REFUND_DUE'], requiresReason: true },
  ],

  FAILED_DELIVERY: [
    { to: 'ASSIGNED', actors: ['ADMIN'], effects: ['NOTIFY_CUSTOMER'] },
    {
      to: 'RETURNED',
      actors: ['ADMIN'],
      effects: ['RELEASE_STOCK', 'REFUND_DUE', 'NOTIFY_CUSTOMER'],
      requiresReason: true,
    },
    {
      to: 'CANCELLED',
      actors: ['ADMIN'],
      effects: ['RELEASE_STOCK', 'RELEASE_COUPON', 'REFUND_DUE', 'NOTIFY_CUSTOMER'],
      requiresReason: true,
    },
  ],

  CANCELLED: [
    // Only when money was actually captured; the service checks the payment first.
    { to: 'REFUNDED', actors: ['ADMIN', 'SYSTEM'], effects: ['REFUND_DUE'] },
  ],

  PAYMENT_FAILED: [
    /**
     * Failed-payment recovery: a retried payment can still confirm the order.
     *
     * RESERVE_STOCK is what makes this safe. The earlier failure gave the units back, so they
     * have to be taken again — and if someone else bought them in the meantime, the shortfall
     * is reported loudly rather than the order confirming against stock that is not there.
     */
    {
      to: 'CONFIRMED',
      actors: ['SYSTEM'],
      effects: ['RESERVE_STOCK', 'NOTIFY_CUSTOMER', 'NOTIFY_VENDOR'],
    },
    { to: 'CANCELLED', actors: ['CUSTOMER', 'SYSTEM', 'ADMIN'], effects: ['RELEASE_COUPON'] },
  ],

  REFUNDED: [],
  RETURNED: [],
};

/** Statuses from which nothing further can happen. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ['REFUNDED', 'RETURNED'];

/**
 * Statuses at which stock is still RESERVED rather than sold or released.
 *
 * Used by the unpaid-timeout sweep and by cancellation, so "is there stock to give back?"
 * is answered in one place instead of being re-derived per caller.
 */
export const STOCK_RESERVED_STATUSES: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
];

/** Statuses a customer-facing tracker should poll frequently. */
export const ACTIVE_STATUSES: readonly OrderStatus[] = [
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
];

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function findTransition(from: OrderStatus, to: OrderStatus): TransitionRule | null {
  return ORDER_TRANSITIONS[from].find((rule) => rule.to === to) ?? null;
}

export function canTransition(from: OrderStatus, to: OrderStatus, actor: TransitionActor): boolean {
  const rule = findTransition(from, to);
  return rule !== null && rule.actors.includes(actor);
}

/**
 * Resolves a transition or throws.
 *
 * Distinguishes "not a legal transition at all" from "legal, but not for you". Collapsing
 * them would make a permission problem look like a bug in the state machine, and an
 * operator chasing the wrong one wastes real time.
 */
export function requireTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: TransitionActor
): TransitionRule {
  const rule = findTransition(from, to);

  if (!rule) {
    throw new StateTransitionError(`An order cannot move from ${from} to ${to}.`, {
      context: { from, to, actor },
      details: { from, to },
    });
  }

  if (!rule.actors.includes(actor)) {
    throw new StateTransitionError(`A ${actor} cannot move an order from ${from} to ${to}.`, {
      context: { from, to, actor, allowedActors: rule.actors },
      details: { from, to },
    });
  }

  return rule;
}

/** Legal next statuses for an actor, for rendering only the buttons that will work. */
export function allowedTransitionsFor(
  from: OrderStatus,
  actor: TransitionActor
): readonly TransitionRule[] {
  return ORDER_TRANSITIONS[from].filter((rule) => rule.actors.includes(actor));
}

/**
 * The timestamp column a status sets, if any.
 *
 * Kept here beside the transitions so a new status cannot be added without deciding
 * whether it stamps a time — those columns drive SLA reporting and delivery-duration
 * metrics, and a silently unset one shows up as a gap in a report nobody trusts.
 */
export const STATUS_TIMESTAMP_COLUMN: Partial<
  Record<OrderStatus, 'confirmedAt' | 'acceptedAt' | 'readyAt' | 'deliveredAt' | 'cancelledAt'>
> = {
  CONFIRMED: 'confirmedAt',
  ACCEPTED: 'acceptedAt',
  READY_FOR_PICKUP: 'readyAt',
  DELIVERED: 'deliveredAt',
  CANCELLED: 'cancelledAt',
};
