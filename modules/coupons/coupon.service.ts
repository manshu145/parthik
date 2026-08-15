import type { Locale } from '@/i18n/routing';
import { BusinessRuleError, NotFoundError } from '@/lib/errors';
import { formatPaise, paise } from '@/lib/money';
import type { AppliedDiscount } from '@/modules/pricing';
import { evaluateCoupon } from './coupon.engine';
import type { CouponRepository } from './coupon.repository.types';
import type {
  CouponAccepted,
  CouponCartLine,
  CouponEvaluation,
  CouponRejected,
  CouponRejectionCode,
  OfferSummary,
} from './coupon.types';

/**
 * Coupon service.
 *
 * Gathers the facts the pure engine needs — the coupon row, the clock, the
 * customer's redemption count, whether this is their first order — then converts
 * the engine's verdict into either an `AppliedDiscount` the pricing engine can use,
 * or a typed error carrying the documented code.
 *
 * The split matters: this file does the I/O and none of the deciding, and
 * `coupon.engine.ts` does the deciding and none of the I/O.
 */

export interface CouponServiceDeps {
  repository: CouponRepository;
  /** Injected so tests can pin the clock at an expiry boundary. */
  now?: () => Date;
}

export interface ApplyCouponInput {
  code: string;
  lines: readonly CouponCartLine[];
  /** Null for a guest. User-scoped coupons cannot pass without one. */
  userId: string | null;
  zoneId: string | null;
  locale: Locale;
}

/**
 * Customer-facing copy for each rejection.
 *
 * Written here rather than in the engine because the engine is pure and must stay
 * free of presentation. Every message says what to DO where there is something to
 * do — "add ₹120 more" is actionable; "not applicable" is not, so it does not
 * pretend to be.
 */
function rejectionMessage(rejection: CouponRejected, locale: Locale): string {
  switch (rejection.reason) {
    case 'COUPON_NOT_FOUND':
      return 'That coupon code was not recognised.';
    case 'COUPON_EXPIRED':
      return 'That coupon has expired.';
    case 'COUPON_INACTIVE':
      return 'That coupon is not available right now.';
    case 'COUPON_MIN_CART_NOT_MET':
      return `Add items worth ${formatPaise(paise(rejection.shortfallPaise ?? 0), locale)} more to use this coupon.`;
    case 'COUPON_USAGE_LIMIT_REACHED':
      return 'That coupon has been fully claimed.';
    case 'COUPON_USER_LIMIT_REACHED':
      return 'You have already used that coupon.';
    case 'COUPON_FIRST_ORDER_ONLY':
      return 'That coupon is only valid on your first order.';
    case 'COUPON_ZONE_RESTRICTED':
      return 'That coupon is not available for your delivery area.';
    case 'COUPON_NOT_APPLICABLE':
      return 'That coupon does not apply to the items in your cart.';
  }
}

/** Safe-to-return facts for the client (docs/API_SPEC.md §1.3). */
function rejectionDetails(rejection: CouponRejected): Record<string, unknown> | undefined {
  if (rejection.reason !== 'COUPON_MIN_CART_NOT_MET') return undefined;

  return {
    minCartPaise: rejection.minCartPaise ?? 0,
    shortfallPaise: rejection.shortfallPaise ?? 0,
  };
}

export class CouponService {
  private readonly now: () => Date;

  constructor(private readonly deps: CouponServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Normalises what a customer typed into the stored form. */
  static normaliseCode(code: string): string {
    return code.trim().toUpperCase();
  }

  /**
   * Evaluates a coupon without throwing.
   *
   * Used when re-checking an ALREADY-APPLIED coupon on every cart read: a cart
   * whose coupon has since expired must still render, with the coupon quietly
   * dropped, rather than failing the whole page.
   */
  async evaluate(input: ApplyCouponInput): Promise<CouponEvaluation> {
    const code = CouponService.normaliseCode(input.code);
    const coupon = await this.deps.repository.findByCode(code);

    if (!coupon) {
      return { isApplicable: false, code, reason: 'COUPON_NOT_FOUND' };
    }

    // Only fetched when a rule actually needs them — a cart coupon with no
    // user-scoped rules should not cost two extra queries per cart read.
    const needsUserFacts =
      input.userId !== null && (coupon.firstOrderOnly || coupon.usageLimitPerUser !== null);

    const [isFirstOrder, userUsageCount] = needsUserFacts
      ? await Promise.all([
          coupon.firstOrderOnly
            ? this.deps.repository.isFirstOrder(input.userId!)
            : Promise.resolve(false),
          coupon.usageLimitPerUser !== null
            ? this.deps.repository.countUserUsages(coupon.id, input.userId!)
            : Promise.resolve(0),
        ])
      : [false, 0];

    return evaluateCoupon(coupon, {
      lines: input.lines,
      now: this.now(),
      userId: input.userId,
      zoneId: input.zoneId,
      isFirstOrder,
      userUsageCount,
    });
  }

  /**
   * Applies a coupon, throwing the documented error when it cannot be applied.
   *
   * Used by `POST /api/v1/cart/coupon`, where the customer is asking a direct
   * question and deserves a direct refusal with a reason.
   */
  async apply(input: ApplyCouponInput): Promise<AppliedDiscount> {
    const evaluation = await this.evaluate(input);

    if (!evaluation.isApplicable) {
      if (evaluation.reason === 'COUPON_NOT_FOUND') {
        // 404, not 400: the code does not exist, which is a different fix for the
        // customer than a code that exists but does not apply.
        throw new NotFoundError(rejectionMessage(evaluation, input.locale));
      }

      const details = rejectionDetails(evaluation);

      throw new BusinessRuleError(
        evaluation.reason satisfies CouponRejectionCode,
        rejectionMessage(evaluation, input.locale),
        details ? { details } : {}
      );
    }

    return toAppliedDiscount(evaluation);
  }

  listOffers(locale: Locale, zoneId: string | null): Promise<OfferSummary[]> {
    return this.deps.repository.listPublicOffers({ locale }, zoneId);
  }
}

/**
 * Converts an accepted evaluation into the pricing engine's input.
 *
 * `eligibleLineIds` is passed ALWAYS, not only for scoped coupons. For a whole-cart
 * coupon it lists every line, so allocation is unchanged — and always sending it
 * means there is no "is this scoped?" branch that could get the answer wrong and
 * quietly spread a category discount across the whole cart.
 */
export function toAppliedDiscount(evaluation: CouponAccepted): AppliedDiscount {
  return {
    couponId: evaluation.couponId,
    code: evaluation.code,
    amountPaise: evaluation.discountPaise,
    waivesDeliveryFee: evaluation.waivesDeliveryFee,
    eligibleLineIds: evaluation.eligibleLineIds,
  };
}

export function createCouponService(deps: CouponServiceDeps): CouponService {
  return new CouponService(deps);
}
