import type { ErrorCode } from '@/lib/errors';

/**
 * Coupon contracts (master spec §18).
 *
 * The engine that consumes these is PURE — no database, no clock, no I/O — so
 * every input it needs is stated here explicitly. That is what makes thirteen
 * interacting rules testable exhaustively rather than by hopeful sampling.
 */

/** Mirrors the `coupon_type` enum. */
export type CouponType = 'FLAT' | 'PERCENTAGE' | 'FREE_DELIVERY';

/** Mirrors the `discount_scope` enum. */
export type CouponScope = 'CART' | 'CATEGORY' | 'PRODUCT' | 'VENDOR' | 'DELIVERY';

/** Mirrors the `coupon_restriction_type` enum. */
export type CouponRestrictionType = 'CATEGORY' | 'PRODUCT' | 'VENDOR' | 'ZONE' | 'USER';

export interface CouponRestriction {
  restrictionType: CouponRestrictionType;
  /** Polymorphic: a category, product, vendor, zone or user id. */
  restrictionId: string;
}

/**
 * A coupon as the engine sees it.
 *
 * Deliberately a plain shape rather than the Drizzle row type: the engine must be
 * callable from a unit test with a literal, and from the in-memory repository,
 * without either depending on the database layer.
 */
export interface Coupon {
  id: string;
  /** Stored and compared uppercase. */
  code: string;
  couponType: CouponType;
  /** Paise for FLAT, whole percent for PERCENTAGE, ignored for FREE_DELIVERY. */
  discountValue: number;
  maxDiscountPaise: number | null;
  minCartPaise: number;
  scope: CouponScope;
  firstOrderOnly: boolean;
  isUserSpecific: boolean;
  usageLimitTotal: number | null;
  usageLimitPerUser: number | null;
  usedCount: number;
  validFrom: Date | null;
  validUntil: Date | null;
  isActive: boolean;
  isStackable: boolean;
  restrictions: readonly CouponRestriction[];
}

/** One cart line, as the coupon engine needs to see it. */
export interface CouponCartLine {
  /** Matches `PricedLine.id` so a caller can correlate results. */
  id: string;
  variantId: string;
  productId: string;
  categoryId: string;
  vendorId: string;
  /**
   * Line value AFTER item-level discounts and BEFORE any coupon — the same base
   * the pricing engine allocates a cart discount across. Using gross here would
   * let a percentage coupon discount money the customer was never charged.
   */
  lineTotalPaise: number;
}

/**
 * Everything outside the coupon row that a decision depends on.
 *
 * `now` is a parameter, not `new Date()`: an engine that reads the clock cannot be
 * tested at an expiry boundary, and expiry boundaries are exactly where coupon
 * bugs live.
 */
export interface CouponEvaluationContext {
  lines: readonly CouponCartLine[];
  now: Date;
  /** Null for a guest. User-scoped rules cannot pass without one. */
  userId: string | null;
  /** Null when no serviceable location has been chosen yet. */
  zoneId: string | null;
  /** Whether this would be the customer's first completed order. */
  isFirstOrder: boolean;
  /** Redemptions by this specific user, for the per-user limit. */
  userUsageCount: number;
}

/** Why a coupon was refused, using the documented API error codes. */
export type CouponRejectionCode = Extract<
  ErrorCode,
  | 'COUPON_NOT_FOUND'
  | 'COUPON_EXPIRED'
  | 'COUPON_INACTIVE'
  | 'COUPON_MIN_CART_NOT_MET'
  | 'COUPON_USAGE_LIMIT_REACHED'
  | 'COUPON_USER_LIMIT_REACHED'
  | 'COUPON_NOT_APPLICABLE'
  | 'COUPON_FIRST_ORDER_ONLY'
  | 'COUPON_ZONE_RESTRICTED'
>;

export interface CouponAccepted {
  isApplicable: true;
  couponId: string;
  code: string;
  /** Discount against items. Always 0 for FREE_DELIVERY. */
  discountPaise: number;
  waivesDeliveryFee: boolean;
  /**
   * Sum of the lines the coupon actually applied to.
   *
   * Reported so a scoped coupon can explain itself ("₹40 off atta") instead of
   * looking like it under-discounted the cart.
   */
  eligibleSubtotalPaise: number;
  /** Ids of the lines the discount was computed from. */
  eligibleLineIds: readonly string[];
}

export interface CouponRejected {
  isApplicable: false;
  code: string;
  reason: CouponRejectionCode;
  /**
   * Extra numbers the UI needs to write a useful message — API_SPEC §5 shows
   * "Add items worth ₹120 more", which requires the shortfall, not just a code.
   */
  minCartPaise?: number;
  shortfallPaise?: number;
}

export type CouponEvaluation = CouponAccepted | CouponRejected;

/** Public-facing coupon copy for the offers page. */
export interface OfferSummary {
  id: string;
  code: string;
  couponType: CouponType;
  discountValue: number;
  maxDiscountPaise: number | null;
  minCartPaise: number;
  firstOrderOnly: boolean;
  validUntil: Date | null;
  /** Resolved for the requested locale with English fallback (D-33). */
  name: string;
  description: string | null;
}
