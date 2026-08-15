import { paise, percentageOfPaise, ZERO_PAISE } from '@/lib/money';
import type {
  Coupon,
  CouponCartLine,
  CouponEvaluation,
  CouponEvaluationContext,
  CouponRejectionCode,
  CouponRestrictionType,
} from './coupon.types';

/**
 * The coupon rule engine (master spec §18).
 *
 * PURE. No database, no clock, no I/O — `now`, `isFirstOrder` and `userUsageCount`
 * are all passed in. Thirteen rules interact here, and the interesting failures are
 * all at boundaries (the second a coupon expires, the redemption that hits the
 * limit). A function that read the clock or the database could not be tested at
 * those boundaries, so it does neither.
 *
 * It decides eligibility and AMOUNT only. Applying the amount to a cart is the
 * pricing engine's job (`AppliedDiscount`), which keeps coupon rules out of pricing
 * and pricing arithmetic out of coupons.
 *
 * ORDER OF CHECKS IS DELIBERATE. Every rejection is a message a customer reads, so
 * the checks run from most to least fundamental: a coupon that does not exist for
 * them at all should not be reported as "add ₹120 more", and a cart that later
 * grows past the minimum should get the minimum-cart message rather than a generic
 * refusal. The order is:
 *
 *   1. is it live at all      — active flag, start date, end date
 *   2. is it used up          — total redemption limit
 *   3. is it for this person  — user-specific, per-user limit, first order
 *   4. is it for this place   — zone restriction
 *   5. is it for these items  — category / product / vendor scope
 *   6. is the cart big enough — minimum cart value
 *   7. what is it worth       — flat / percentage / cap
 *
 * STACKING: `coupons.is_stackable` is stored but not honoured, because a cart holds
 * exactly one coupon (`carts.applied_coupon_id` is a single column). Multi-coupon
 * stacking is a product decision with no specification, so it is not invented here.
 */

/** Restriction types that narrow WHICH LINES a coupon applies to. */
const LINE_SCOPED: readonly CouponRestrictionType[] = ['CATEGORY', 'PRODUCT', 'VENDOR'];

function reject(
  code: string,
  reason: CouponRejectionCode,
  extra: { minCartPaise?: number; shortfallPaise?: number } = {}
): CouponEvaluation {
  return { isApplicable: false, code, reason, ...extra };
}

function restrictionIds(coupon: Coupon, type: CouponRestrictionType): string[] {
  return coupon.restrictions
    .filter((restriction) => restriction.restrictionType === type)
    .map((restriction) => restriction.restrictionId);
}

/**
 * Whether a line falls inside the coupon's item scope.
 *
 * OR within a restriction type, AND across types. A coupon restricted to category
 * "staples" and vendor "demo-kirana" means staples FROM that vendor — narrowing on
 * two axes is the only reading that makes both restrictions meaningful.
 */
function isLineEligible(line: CouponCartLine, coupon: Coupon): boolean {
  const fields: Record<'CATEGORY' | 'PRODUCT' | 'VENDOR', string> = {
    CATEGORY: line.categoryId,
    PRODUCT: line.productId,
    VENDOR: line.vendorId,
  };

  for (const type of LINE_SCOPED) {
    const ids = restrictionIds(coupon, type);
    // No restriction of this type means this axis does not narrow anything.
    if (ids.length === 0) continue;
    if (!ids.includes(fields[type as 'CATEGORY' | 'PRODUCT' | 'VENDOR'])) return false;
  }

  return true;
}

/**
 * Whether any user-scoped rule is in play.
 *
 * A guest cannot satisfy these — we cannot count their past redemptions or know
 * whether this is their first order — so the coupon is refused rather than granted
 * on trust. Granting it would make first-order coupons infinitely reusable by
 * signing out.
 */
function needsIdentity(coupon: Coupon): boolean {
  return (
    coupon.firstOrderOnly ||
    coupon.isUserSpecific ||
    coupon.usageLimitPerUser !== null ||
    restrictionIds(coupon, 'USER').length > 0
  );
}

export function evaluateCoupon(coupon: Coupon, context: CouponEvaluationContext): CouponEvaluation {
  const { code } = coupon;

  // ---- 1. Is it live at all? ----
  if (!coupon.isActive) return reject(code, 'COUPON_INACTIVE');

  // Not started yet is INACTIVE, not EXPIRED: telling a customer a future coupon
  // has expired is simply wrong.
  if (coupon.validFrom && context.now < coupon.validFrom) {
    return reject(code, 'COUPON_INACTIVE');
  }

  // Inclusive of the instant itself: a coupon valid "until 23:59:59" is still valid
  // AT 23:59:59.
  if (coupon.validUntil && context.now > coupon.validUntil) {
    return reject(code, 'COUPON_EXPIRED');
  }

  // ---- 2. Is it used up? ----
  if (coupon.usageLimitTotal !== null && coupon.usedCount >= coupon.usageLimitTotal) {
    return reject(code, 'COUPON_USAGE_LIMIT_REACHED');
  }

  // ---- 3. Is it for this person? ----
  if (needsIdentity(coupon) && context.userId === null) {
    return reject(code, 'COUPON_NOT_APPLICABLE');
  }

  const allowedUsers = restrictionIds(coupon, 'USER');

  if (coupon.isUserSpecific && allowedUsers.length === 0) {
    // Flagged as user-specific with nobody named. Refusing is the safe reading:
    // treating it as open to everyone would hand a targeted coupon to the world.
    return reject(code, 'COUPON_NOT_APPLICABLE');
  }

  if (allowedUsers.length > 0 && !allowedUsers.includes(context.userId!)) {
    return reject(code, 'COUPON_NOT_APPLICABLE');
  }

  if (coupon.usageLimitPerUser !== null && context.userUsageCount >= coupon.usageLimitPerUser) {
    return reject(code, 'COUPON_USER_LIMIT_REACHED');
  }

  if (coupon.firstOrderOnly && !context.isFirstOrder) {
    return reject(code, 'COUPON_FIRST_ORDER_ONLY');
  }

  // ---- 4. Is it for this place? ----
  const allowedZones = restrictionIds(coupon, 'ZONE');

  if (allowedZones.length > 0) {
    // No zone means no chosen delivery location, so a zone-restricted coupon cannot
    // be confirmed. Refusing now is better than accepting it and withdrawing it at
    // checkout.
    if (context.zoneId === null || !allowedZones.includes(context.zoneId)) {
      return reject(code, 'COUPON_ZONE_RESTRICTED');
    }
  }

  // ---- 5. Is it for these items? ----
  if (context.lines.length === 0) return reject(code, 'COUPON_NOT_APPLICABLE');

  const eligible = context.lines.filter((line) => isLineEligible(line, coupon));

  if (eligible.length === 0) return reject(code, 'COUPON_NOT_APPLICABLE');

  const eligibleSubtotal = eligible.reduce((sum, line) => sum + line.lineTotalPaise, 0);

  // ---- 6. Is the cart big enough? ----
  // Measured against the WHOLE cart, not the eligible subset: "minimum cart value"
  // means the cart. A ₹500 cart with ₹100 of eligible items has met a ₹499
  // minimum, and telling that customer to add more would be indefensible.
  const cartSubtotal = context.lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);

  if (cartSubtotal < coupon.minCartPaise) {
    return reject(code, 'COUPON_MIN_CART_NOT_MET', {
      minCartPaise: coupon.minCartPaise,
      shortfallPaise: coupon.minCartPaise - cartSubtotal,
    });
  }

  // ---- 7. What is it worth? ----
  const accepted = {
    isApplicable: true as const,
    couponId: coupon.id,
    code,
    eligibleSubtotalPaise: eligibleSubtotal,
    eligibleLineIds: eligible.map((line) => line.id),
  };

  if (coupon.couponType === 'FREE_DELIVERY') {
    // Waives the fee instead of discounting items. The fee itself is the pricing
    // engine's number, so no amount is computed here.
    return { ...accepted, discountPaise: ZERO_PAISE, waivesDeliveryFee: true };
  }

  const raw =
    coupon.couponType === 'FLAT'
      ? paise(coupon.discountValue)
      : percentageOfPaise(paise(eligibleSubtotal), coupon.discountValue);

  const capped =
    coupon.maxDiscountPaise === null ? raw : paise(Math.min(raw, coupon.maxDiscountPaise));

  // Never more than the items it applies to. This is what stops a ₹200 coupon on a
  // ₹150 eligible subtotal from eating the delivery fee or turning the total
  // negative — the pricing engine clamps too, but a coupon that reports more than
  // it delivers would misstate the saving in the UI.
  const discountPaise = paise(Math.min(capped, eligibleSubtotal));

  if (discountPaise <= 0) {
    // A coupon worth nothing is misconfigured, or rounds to zero on a cart this
    // small. Either way "applied — you saved ₹0" is worse than a clear refusal.
    return reject(code, 'COUPON_NOT_APPLICABLE');
  }

  return { ...accepted, discountPaise, waivesDeliveryFee: false };
}
