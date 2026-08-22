import type { OrderStatus } from './order.state';

/**
 * The cancellation and refund policy engine (D-19, docs/DATABASE.md §6.3).
 *
 * The rules are DATA, not conditionals scattered through services. A refund percentage
 * hardcoded in three places is a refund percentage that will be wrong in at least one of
 * them, and the wrong one only shows up as a customer complaint.
 *
 * 🔴 D-19a IS BLOCKED: the VALUES are a commercial decision that has not been made. This
 * engine is complete and the table ships with a deliberately CONSERVATIVE seed only —
 * customer may cancel before ACCEPTED with a full refund, admin may cancel at any
 * pre-delivery status. Every other window, percentage, restocking rule and driver
 * compensation rule needs a business answer. No percentage is invented here.
 */

export type CancellationActor = 'CUSTOMER' | 'VENDOR' | 'ADMIN';

export type PaymentMethodScope = 'ALL' | 'PREPAID' | 'COD';

export interface CancellationPolicy {
  actorRole: CancellationActor;
  fromStatus: OrderStatus;
  isAllowed: boolean;
  /** Minutes from placement. Null means no time limit. */
  windowMinutes: number | null;
  /** Percentage of item value refunded, 0–100. */
  refundPercent: number;
  refundDeliveryFee: boolean;
  requiresReason: boolean;
  restock: boolean;
  compensateDriver: boolean;
  paymentMethodScope: PaymentMethodScope;
  priority: number;
}

export interface CancellationDecision {
  isAllowed: boolean;
  /** Why not, when refused. Machine-readable so the UI can explain itself. */
  reason?: 'NOT_PERMITTED' | 'WINDOW_EXPIRED' | 'NO_POLICY';
  refundPercent: number;
  refundAmountPaise: number;
  refundDeliveryFee: boolean;
  requiresReason: boolean;
  restock: boolean;
  compensateDriver: boolean;
}

export interface EvaluateInput {
  actor: CancellationActor;
  status: OrderStatus;
  isCod: boolean;
  placedAt: Date;
  /** Item value before delivery and other fees. */
  itemValuePaise: number;
  deliveryFeePaise: number;
  now?: Date;
}

/**
 * The conservative seed (docs/DATABASE.md §6.3).
 *
 * Deliberately minimal. Anything not listed here is REFUSED, which is the correct default
 * while D-19a is unanswered: refusing a cancellation is recoverable through support, whereas
 * refunding 50% because a placeholder said so is not.
 */
export const CONSERVATIVE_CANCELLATION_POLICIES: readonly CancellationPolicy[] = [
  {
    // Before the vendor has accepted, nothing has been done and nothing has been spent.
    actorRole: 'CUSTOMER',
    fromStatus: 'CONFIRMED',
    isAllowed: true,
    windowMinutes: null,
    refundPercent: 100,
    refundDeliveryFee: true,
    requiresReason: false,
    restock: true,
    compensateDriver: false,
    paymentMethodScope: 'ALL',
    priority: 0,
  },
  {
    // An unpaid order has taken no money, so a "refund" is a no-op — but the cancellation
    // must still be permitted so the customer can abandon and free the stock.
    actorRole: 'CUSTOMER',
    fromStatus: 'PENDING_PAYMENT',
    isAllowed: true,
    windowMinutes: null,
    refundPercent: 100,
    refundDeliveryFee: true,
    requiresReason: false,
    restock: true,
    compensateDriver: false,
    paymentMethodScope: 'ALL',
    priority: 0,
  },
  // Admin may cancel at any pre-delivery status. Full refund, because a platform-initiated
  // cancellation is not the customer's fault.
  ...(
    [
      'PENDING_PAYMENT',
      'CONFIRMED',
      'ACCEPTED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'ASSIGNED',
    ] as const
  ).map((status): CancellationPolicy => ({
    actorRole: 'ADMIN',
    fromStatus: status,
    isAllowed: true,
    windowMinutes: null,
    refundPercent: 100,
    refundDeliveryFee: true,
    requiresReason: true,
    restock: true,
    // Whether a driver already dispatched should be paid is a commercial decision (D-19a).
    compensateDriver: false,
    paymentMethodScope: 'ALL',
    priority: 0,
  })),
  // A vendor rejecting an order they cannot fulfil. Full refund for the same reason.
  ...(['CONFIRMED', 'ACCEPTED', 'PREPARING'] as const).map((status): CancellationPolicy => ({
    actorRole: 'VENDOR',
    fromStatus: status,
    isAllowed: true,
    windowMinutes: null,
    refundPercent: 100,
    refundDeliveryFee: true,
    requiresReason: true,
    restock: true,
    compensateDriver: false,
    paymentMethodScope: 'ALL',
    priority: 0,
  })),
];

/**
 * Resolves the policy for an attempt and computes the refund.
 *
 * FAILS CLOSED: no matching policy means not allowed. That is the whole reason the engine
 * exists separately from the state machine — the state machine says a transition is
 * structurally possible, and this says whether the business permits it and on what terms.
 */
export function evaluateCancellation(
  input: EvaluateInput,
  policies: readonly CancellationPolicy[] = CONSERVATIVE_CANCELLATION_POLICIES
): CancellationDecision {
  const scope: PaymentMethodScope = input.isCod ? 'COD' : 'PREPAID';

  const candidates = policies
    .filter(
      (policy) =>
        policy.actorRole === input.actor &&
        policy.fromStatus === input.status &&
        (policy.paymentMethodScope === 'ALL' || policy.paymentMethodScope === scope)
    )
    // A method-specific rule beats a catch-all, then higher priority wins. Without this
    // ordering a COD-specific policy could be shadowed by an `ALL` one.
    .sort((a, b) => {
      const specificity =
        Number(b.paymentMethodScope !== 'ALL') - Number(a.paymentMethodScope !== 'ALL');
      return specificity !== 0 ? specificity : b.priority - a.priority;
    });

  const policy = candidates[0];

  if (!policy) return refuse('NO_POLICY');
  if (!policy.isAllowed) return refuse('NOT_PERMITTED', policy);

  if (policy.windowMinutes !== null) {
    const elapsedMinutes =
      ((input.now ?? new Date()).getTime() - input.placedAt.getTime()) / 60_000;
    if (elapsedMinutes > policy.windowMinutes) return refuse('WINDOW_EXPIRED', policy);
  }

  // Rounded DOWN, and the delivery fee is added only when the policy says so. Rounding up
  // would refund more than the rule allows, which is a real cost multiplied by every order.
  const itemRefund = Math.floor((input.itemValuePaise * policy.refundPercent) / 100);
  const refundAmountPaise = itemRefund + (policy.refundDeliveryFee ? input.deliveryFeePaise : 0);

  return {
    isAllowed: true,
    refundPercent: policy.refundPercent,
    refundAmountPaise,
    refundDeliveryFee: policy.refundDeliveryFee,
    requiresReason: policy.requiresReason,
    restock: policy.restock,
    compensateDriver: policy.compensateDriver,
  };
}

function refuse(
  reason: NonNullable<CancellationDecision['reason']>,
  policy?: CancellationPolicy
): CancellationDecision {
  return {
    isAllowed: false,
    reason,
    refundPercent: 0,
    refundAmountPaise: 0,
    refundDeliveryFee: false,
    requiresReason: policy?.requiresReason ?? true,
    restock: false,
    compensateDriver: false,
  };
}

/** Whether an actor can cancel at all, for rendering a button. */
export function canCancel(
  input: EvaluateInput,
  policies: readonly CancellationPolicy[] = CONSERVATIVE_CANCELLATION_POLICIES
): boolean {
  return evaluateCancellation(input, policies).isAllowed;
}
