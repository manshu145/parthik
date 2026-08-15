import { describe, expect, it } from 'vitest';
import { evaluateCoupon } from '@/modules/coupons/coupon.engine';
import type {
  Coupon,
  CouponCartLine,
  CouponEvaluationContext,
  CouponRestriction,
} from '@/modules/coupons/coupon.types';

/**
 * Coupon rule engine tests (master spec §18).
 *
 * docs/ARCHITECTURE.md §16 requires the money-handling engines to be tested
 * exhaustively, and coupons are the sharpest case: thirteen rules that interact,
 * every one of them attached to a discount someone is owed or is not.
 *
 * The engine is pure, so `now` and the usage counts are inputs — which is what lets
 * these tests sit exactly ON the boundaries (the instant of expiry, the redemption
 * that reaches the limit) instead of near them.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z');

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'coupon-1',
    code: 'SAVE50',
    couponType: 'FLAT',
    discountValue: 5_000,
    maxDiscountPaise: null,
    minCartPaise: 0,
    scope: 'CART',
    firstOrderOnly: false,
    isUserSpecific: false,
    usageLimitTotal: null,
    usageLimitPerUser: null,
    usedCount: 0,
    validFrom: null,
    validUntil: null,
    isActive: true,
    isStackable: false,
    restrictions: [],
    ...overrides,
  };
}

function line(overrides: Partial<CouponCartLine> = {}): CouponCartLine {
  return {
    id: 'line-1',
    variantId: 'variant-1',
    productId: 'product-1',
    categoryId: 'category-staples',
    vendorId: 'vendor-1',
    lineTotalPaise: 30_000,
    ...overrides,
  };
}

function context(overrides: Partial<CouponEvaluationContext> = {}): CouponEvaluationContext {
  return {
    lines: [line()],
    now: NOW,
    userId: 'user-1',
    zoneId: 'zone-1',
    isFirstOrder: true,
    userUsageCount: 0,
    ...overrides,
  };
}

function restriction(
  restrictionType: CouponRestriction['restrictionType'],
  restrictionId: string
): CouponRestriction {
  return { restrictionType, restrictionId };
}

/** Narrowing helper so accepted-only fields can be asserted without casts. */
function accept(result: ReturnType<typeof evaluateCoupon>) {
  if (!result.isApplicable) {
    throw new Error(`Expected the coupon to apply, got ${result.reason}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Flat discount
// ---------------------------------------------------------------------------

describe('flat discount', () => {
  it('applies the flat amount', () => {
    const result = accept(evaluateCoupon(coupon({ discountValue: 5_000 }), context()));

    expect(result.discountPaise).toBe(5_000);
    expect(result.waivesDeliveryFee).toBe(false);
    expect(result.couponId).toBe('coupon-1');
    expect(result.code).toBe('SAVE50');
  });

  it('never discounts more than the cart is worth', () => {
    // Otherwise the total goes negative, or the coupon starts eating the delivery
    // fee, which a FLAT coupon has no business touching.
    const result = accept(
      evaluateCoupon(
        coupon({ discountValue: 50_000 }),
        context({ lines: [line({ lineTotalPaise: 12_000 })] })
      )
    );

    expect(result.discountPaise).toBe(12_000);
  });

  it('applies exactly the cart value at the boundary', () => {
    const result = accept(
      evaluateCoupon(
        coupon({ discountValue: 12_000 }),
        context({ lines: [line({ lineTotalPaise: 12_000 })] })
      )
    );

    expect(result.discountPaise).toBe(12_000);
  });

  it('refuses a coupon worth nothing', () => {
    const result = evaluateCoupon(coupon({ discountValue: 0 }), context());

    // "Applied — you saved ₹0" is worse than a refusal.
    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_NOT_APPLICABLE' });
  });
});

// ---------------------------------------------------------------------------
// Percentage discount and cap
// ---------------------------------------------------------------------------

describe('percentage discount', () => {
  it('applies a percentage of the eligible subtotal', () => {
    const result = accept(
      evaluateCoupon(
        coupon({ couponType: 'PERCENTAGE', discountValue: 10 }),
        context({ lines: [line({ lineTotalPaise: 30_000 })] })
      )
    );

    expect(result.discountPaise).toBe(3_000);
  });

  it('rounds half-up, like every other money calculation', () => {
    // 10% of 12,345 paise = 1,234.5 → 1,235. Rounding down here would leave the
    // customer a paise short of what the percentage promises.
    const result = accept(
      evaluateCoupon(
        coupon({ couponType: 'PERCENTAGE', discountValue: 10 }),
        context({ lines: [line({ lineTotalPaise: 12_345 })] })
      )
    );

    expect(result.discountPaise).toBe(1_235);
  });

  it('honours the maximum discount', () => {
    const result = accept(
      evaluateCoupon(
        coupon({ couponType: 'PERCENTAGE', discountValue: 50, maxDiscountPaise: 7_500 }),
        context({ lines: [line({ lineTotalPaise: 100_000 })] })
      )
    );

    expect(result.discountPaise).toBe(7_500);
  });

  it('does not apply the cap when the percentage falls below it', () => {
    const result = accept(
      evaluateCoupon(
        coupon({ couponType: 'PERCENTAGE', discountValue: 10, maxDiscountPaise: 7_500 }),
        context({ lines: [line({ lineTotalPaise: 30_000 })] })
      )
    );

    expect(result.discountPaise).toBe(3_000);
  });

  it('caps a misconfigured percentage above 100 at the cart value', () => {
    // Nothing stops an admin typing 150. Clamping is the safe reading; a negative
    // total is not.
    const result = accept(
      evaluateCoupon(
        coupon({ couponType: 'PERCENTAGE', discountValue: 150 }),
        context({ lines: [line({ lineTotalPaise: 20_000 })] })
      )
    );

    expect(result.discountPaise).toBe(20_000);
  });

  it('refuses a percentage that rounds away to nothing', () => {
    const result = evaluateCoupon(
      coupon({ couponType: 'PERCENTAGE', discountValue: 1 }),
      context({ lines: [line({ lineTotalPaise: 20 })] })
    );

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_NOT_APPLICABLE' });
  });
});

// ---------------------------------------------------------------------------
// Free delivery
// ---------------------------------------------------------------------------

describe('free delivery', () => {
  it('waives the fee instead of discounting items', () => {
    const result = accept(
      evaluateCoupon(coupon({ couponType: 'FREE_DELIVERY', discountValue: 0 }), context())
    );

    expect(result.discountPaise).toBe(0);
    expect(result.waivesDeliveryFee).toBe(true);
  });

  it('is not refused for being worth zero against items', () => {
    // The zero-discount guard must not catch this type: the value is the waived fee,
    // which only the pricing engine knows.
    const result = evaluateCoupon(
      coupon({ couponType: 'FREE_DELIVERY', discountValue: 0 }),
      context()
    );

    expect(result.isApplicable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Minimum cart value
// ---------------------------------------------------------------------------

describe('minimum cart value', () => {
  it('refuses a cart below the minimum, with the shortfall', () => {
    const result = evaluateCoupon(
      coupon({ minCartPaise: 30_000 }),
      context({ lines: [line({ lineTotalPaise: 18_000 })] })
    );

    // API_SPEC §5 shows "Add items worth ₹120 more", which needs the number.
    expect(result).toMatchObject({
      isApplicable: false,
      reason: 'COUPON_MIN_CART_NOT_MET',
      minCartPaise: 30_000,
      shortfallPaise: 12_000,
    });
  });

  it('accepts a cart exactly at the minimum', () => {
    const result = evaluateCoupon(
      coupon({ minCartPaise: 30_000 }),
      context({ lines: [line({ lineTotalPaise: 30_000 })] })
    );

    expect(result.isApplicable).toBe(true);
  });

  it('refuses a cart one paise short', () => {
    const result = evaluateCoupon(
      coupon({ minCartPaise: 30_000 }),
      context({ lines: [line({ lineTotalPaise: 29_999 })] })
    );

    expect(result).toMatchObject({ isApplicable: false, shortfallPaise: 1 });
  });

  it('measures the WHOLE cart, not just the eligible items', () => {
    // A ₹500 cart with ₹100 of eligible staples has met a ₹299 minimum. Measuring
    // the eligible subset instead would tell that customer to add more when they
    // plainly have enough.
    const result = evaluateCoupon(
      coupon({
        couponType: 'PERCENTAGE',
        discountValue: 10,
        minCartPaise: 29_900,
        restrictions: [restriction('CATEGORY', 'category-staples')],
      }),
      context({
        lines: [
          line({ id: 'a', lineTotalPaise: 10_000, categoryId: 'category-staples' }),
          line({ id: 'b', lineTotalPaise: 40_000, categoryId: 'category-snacks' }),
        ],
      })
    );

    const accepted = accept(result);
    // Discount is still computed on the eligible ₹100 only.
    expect(accepted.eligibleSubtotalPaise).toBe(10_000);
    expect(accepted.discountPaise).toBe(1_000);
  });
});

// ---------------------------------------------------------------------------
// Validity window
// ---------------------------------------------------------------------------

describe('validity window', () => {
  it('refuses an inactive coupon', () => {
    const result = evaluateCoupon(coupon({ isActive: false }), context());

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_INACTIVE' });
  });

  it('reports a not-yet-started coupon as inactive, not expired', () => {
    // Telling a customer a future coupon has expired is simply wrong.
    const result = evaluateCoupon(
      coupon({ validFrom: new Date('2026-07-01T00:00:00.000Z') }),
      context()
    );

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_INACTIVE' });
  });

  it('accepts a coupon at the exact instant it starts', () => {
    const result = evaluateCoupon(coupon({ validFrom: NOW }), context());

    expect(result.isApplicable).toBe(true);
  });

  it('refuses an expired coupon', () => {
    const result = evaluateCoupon(
      coupon({ validUntil: new Date('2026-06-01T00:00:00.000Z') }),
      context()
    );

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_EXPIRED' });
  });

  it('accepts a coupon at the exact instant it ends', () => {
    // "Valid until 23:59:59" must still be valid AT 23:59:59.
    const result = evaluateCoupon(coupon({ validUntil: NOW }), context());

    expect(result.isApplicable).toBe(true);
  });

  it('refuses one millisecond after expiry', () => {
    const result = evaluateCoupon(coupon({ validUntil: new Date(NOW.getTime() - 1) }), context());

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_EXPIRED' });
  });

  it('accepts a coupon inside an open-ended window', () => {
    const result = evaluateCoupon(coupon({ validFrom: null, validUntil: null }), context());

    expect(result.isApplicable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Usage limits
// ---------------------------------------------------------------------------

describe('total usage limit', () => {
  it('accepts while redemptions remain', () => {
    const result = evaluateCoupon(coupon({ usageLimitTotal: 100, usedCount: 99 }), context());

    expect(result.isApplicable).toBe(true);
  });

  it('refuses at the limit', () => {
    const result = evaluateCoupon(coupon({ usageLimitTotal: 100, usedCount: 100 }), context());

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_USAGE_LIMIT_REACHED' });
  });

  it('refuses past the limit', () => {
    // A race at checkout can overshoot; the coupon must stay closed, not reopen.
    const result = evaluateCoupon(coupon({ usageLimitTotal: 100, usedCount: 140 }), context());

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_USAGE_LIMIT_REACHED' });
  });

  it('treats a null limit as unlimited', () => {
    const result = evaluateCoupon(coupon({ usageLimitTotal: null, usedCount: 99_999 }), context());

    expect(result.isApplicable).toBe(true);
  });
});

describe('per-user limit', () => {
  it('accepts below the limit', () => {
    const result = evaluateCoupon(coupon({ usageLimitPerUser: 2 }), context({ userUsageCount: 1 }));

    expect(result.isApplicable).toBe(true);
  });

  it('refuses at the limit', () => {
    const result = evaluateCoupon(coupon({ usageLimitPerUser: 2 }), context({ userUsageCount: 2 }));

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_USER_LIMIT_REACHED' });
  });

  it('refuses a guest, who cannot be counted', () => {
    // Otherwise signing out resets a per-user limit.
    const result = evaluateCoupon(coupon({ usageLimitPerUser: 1 }), context({ userId: null }));

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_NOT_APPLICABLE' });
  });

  it('reports the total limit before the per-user one', () => {
    // An exhausted coupon is exhausted for everybody; "you have already used that"
    // would be a lie.
    const result = evaluateCoupon(
      coupon({ usageLimitTotal: 10, usedCount: 10, usageLimitPerUser: 1 }),
      context({ userUsageCount: 5 })
    );

    expect(result).toMatchObject({ reason: 'COUPON_USAGE_LIMIT_REACHED' });
  });
});

// ---------------------------------------------------------------------------
// First order
// ---------------------------------------------------------------------------

describe('first order only', () => {
  it('accepts a first order', () => {
    const result = evaluateCoupon(
      coupon({ firstOrderOnly: true }),
      context({ isFirstOrder: true })
    );

    expect(result.isApplicable).toBe(true);
  });

  it('refuses a returning customer', () => {
    const result = evaluateCoupon(
      coupon({ firstOrderOnly: true }),
      context({ isFirstOrder: false })
    );

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_FIRST_ORDER_ONLY' });
  });

  it('refuses a guest, whose history is unknown', () => {
    // Granting it on trust would make a first-order coupon infinitely reusable by
    // signing out.
    const result = evaluateCoupon(
      coupon({ firstOrderOnly: true }),
      context({ userId: null, isFirstOrder: true })
    );

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_NOT_APPLICABLE' });
  });

  it('ignores first-order status when the coupon does not care', () => {
    const result = evaluateCoupon(
      coupon({ firstOrderOnly: false }),
      context({ isFirstOrder: false })
    );

    expect(result.isApplicable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// User-specific
// ---------------------------------------------------------------------------

describe('user-specific coupons', () => {
  it('accepts the named user', () => {
    const result = evaluateCoupon(
      coupon({ isUserSpecific: true, restrictions: [restriction('USER', 'user-1')] }),
      context({ userId: 'user-1' })
    );

    expect(result.isApplicable).toBe(true);
  });

  it('refuses anybody else', () => {
    const result = evaluateCoupon(
      coupon({ isUserSpecific: true, restrictions: [restriction('USER', 'user-1')] }),
      context({ userId: 'user-2' })
    );

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_NOT_APPLICABLE' });
  });

  it('accepts any of several named users', () => {
    const result = evaluateCoupon(
      coupon({
        isUserSpecific: true,
        restrictions: [restriction('USER', 'user-1'), restriction('USER', 'user-9')],
      }),
      context({ userId: 'user-9' })
    );

    expect(result.isApplicable).toBe(true);
  });

  it('refuses a coupon flagged user-specific with nobody named', () => {
    // Treating a misconfigured targeted coupon as open to everyone would hand it to
    // the world. Refusing is the safe reading.
    const result = evaluateCoupon(coupon({ isUserSpecific: true, restrictions: [] }), context());

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_NOT_APPLICABLE' });
  });

  it('honours USER restrictions even without the flag', () => {
    // The restriction row is the harder fact; a missing flag must not open it up.
    const result = evaluateCoupon(
      coupon({ isUserSpecific: false, restrictions: [restriction('USER', 'user-1')] }),
      context({ userId: 'user-2' })
    );

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_NOT_APPLICABLE' });
  });
});

// ---------------------------------------------------------------------------
// Zone restriction
// ---------------------------------------------------------------------------

describe('zone restriction', () => {
  it('accepts a permitted zone', () => {
    const result = evaluateCoupon(
      coupon({ restrictions: [restriction('ZONE', 'zone-1')] }),
      context({ zoneId: 'zone-1' })
    );

    expect(result.isApplicable).toBe(true);
  });

  it('refuses another zone', () => {
    const result = evaluateCoupon(
      coupon({ restrictions: [restriction('ZONE', 'zone-1')] }),
      context({ zoneId: 'zone-2' })
    );

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_ZONE_RESTRICTED' });
  });

  it('refuses when no location has been chosen', () => {
    // Accepting now and withdrawing at checkout is worse than refusing now.
    const result = evaluateCoupon(
      coupon({ restrictions: [restriction('ZONE', 'zone-1')] }),
      context({ zoneId: null })
    );

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_ZONE_RESTRICTED' });
  });

  it('ignores the zone when the coupon is unrestricted', () => {
    const result = evaluateCoupon(coupon({ restrictions: [] }), context({ zoneId: null }));

    expect(result.isApplicable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Item scoping
// ---------------------------------------------------------------------------

describe('category scoping', () => {
  it('discounts only the matching lines', () => {
    const result = accept(
      evaluateCoupon(
        coupon({
          couponType: 'PERCENTAGE',
          discountValue: 10,
          restrictions: [restriction('CATEGORY', 'category-staples')],
        }),
        context({
          lines: [
            line({ id: 'a', lineTotalPaise: 20_000, categoryId: 'category-staples' }),
            line({ id: 'b', lineTotalPaise: 50_000, categoryId: 'category-snacks' }),
          ],
        })
      )
    );

    expect(result.eligibleSubtotalPaise).toBe(20_000);
    expect(result.eligibleLineIds).toEqual(['a']);
    expect(result.discountPaise).toBe(2_000);
  });

  it('accepts a line in any of several categories', () => {
    const result = accept(
      evaluateCoupon(
        coupon({
          restrictions: [
            restriction('CATEGORY', 'category-staples'),
            restriction('CATEGORY', 'category-snacks'),
          ],
        }),
        context({
          lines: [
            line({ id: 'a', lineTotalPaise: 20_000, categoryId: 'category-staples' }),
            line({ id: 'b', lineTotalPaise: 50_000, categoryId: 'category-snacks' }),
          ],
        })
      )
    );

    expect(result.eligibleLineIds).toEqual(['a', 'b']);
  });

  it('refuses when nothing in the cart matches', () => {
    const result = evaluateCoupon(
      coupon({ restrictions: [restriction('CATEGORY', 'category-electronics')] }),
      context()
    );

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_NOT_APPLICABLE' });
  });
});

describe('product scoping', () => {
  it('discounts only the named product', () => {
    const result = accept(
      evaluateCoupon(
        coupon({ restrictions: [restriction('PRODUCT', 'product-atta')] }),
        context({
          lines: [
            line({ id: 'a', lineTotalPaise: 20_000, productId: 'product-atta' }),
            line({ id: 'b', lineTotalPaise: 50_000, productId: 'product-dal' }),
          ],
        })
      )
    );

    expect(result.eligibleLineIds).toEqual(['a']);
    expect(result.eligibleSubtotalPaise).toBe(20_000);
  });
});

describe('vendor scoping', () => {
  it('discounts only the named vendor', () => {
    const result = accept(
      evaluateCoupon(
        coupon({ restrictions: [restriction('VENDOR', 'vendor-9')] }),
        context({
          lines: [
            line({ id: 'a', lineTotalPaise: 20_000, vendorId: 'vendor-9' }),
            line({ id: 'b', lineTotalPaise: 50_000, vendorId: 'vendor-1' }),
          ],
        })
      )
    );

    expect(result.eligibleLineIds).toEqual(['a']);
  });
});

describe('combined scoping', () => {
  it('narrows on both axes at once', () => {
    // Category "staples" AND vendor "vendor-9" means staples FROM that vendor.
    // Reading it as OR would discount things the campaign never covered.
    const result = accept(
      evaluateCoupon(
        coupon({
          restrictions: [
            restriction('CATEGORY', 'category-staples'),
            restriction('VENDOR', 'vendor-9'),
          ],
        }),
        context({
          lines: [
            line({
              id: 'match',
              lineTotalPaise: 20_000,
              categoryId: 'category-staples',
              vendorId: 'vendor-9',
            }),
            line({
              id: 'wrong-vendor',
              lineTotalPaise: 20_000,
              categoryId: 'category-staples',
              vendorId: 'vendor-1',
            }),
            line({
              id: 'wrong-category',
              lineTotalPaise: 20_000,
              categoryId: 'category-snacks',
              vendorId: 'vendor-9',
            }),
          ],
        })
      )
    );

    expect(result.eligibleLineIds).toEqual(['match']);
  });

  it('caps a scoped flat discount at the eligible subtotal, not the cart', () => {
    // The whole point of scoping: a ₹500-off staples coupon must not consume the
    // value of the snacks in the same cart.
    const result = accept(
      evaluateCoupon(
        coupon({
          discountValue: 50_000,
          restrictions: [restriction('CATEGORY', 'category-staples')],
        }),
        context({
          lines: [
            line({ id: 'a', lineTotalPaise: 8_000, categoryId: 'category-staples' }),
            line({ id: 'b', lineTotalPaise: 90_000, categoryId: 'category-snacks' }),
          ],
        })
      )
    );

    expect(result.discountPaise).toBe(8_000);
  });
});

// ---------------------------------------------------------------------------
// Empty cart and check ordering
// ---------------------------------------------------------------------------

describe('empty cart', () => {
  it('refuses a coupon with nothing to discount', () => {
    const result = evaluateCoupon(coupon(), context({ lines: [] }));

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_NOT_APPLICABLE' });
  });
});

describe('order of checks', () => {
  it('reports expiry before the minimum cart', () => {
    // Telling a customer to add ₹200 to use a coupon that expired last week wastes
    // their time.
    const result = evaluateCoupon(
      coupon({ validUntil: new Date('2026-01-01T00:00:00.000Z'), minCartPaise: 100_000 }),
      context({ lines: [line({ lineTotalPaise: 1_000 })] })
    );

    expect(result).toMatchObject({ reason: 'COUPON_EXPIRED' });
  });

  it('reports the inactive flag before anything else', () => {
    const result = evaluateCoupon(
      coupon({
        isActive: false,
        validUntil: new Date('2026-01-01T00:00:00.000Z'),
        usageLimitTotal: 1,
        usedCount: 5,
      }),
      context()
    );

    expect(result).toMatchObject({ reason: 'COUPON_INACTIVE' });
  });

  it('reports item applicability before the minimum cart', () => {
    // "Add ₹200 more" is misleading when no amount of the wrong category will help.
    const result = evaluateCoupon(
      coupon({
        minCartPaise: 100_000,
        restrictions: [restriction('CATEGORY', 'category-electronics')],
      }),
      context({ lines: [line({ lineTotalPaise: 1_000 })] })
    );

    expect(result).toMatchObject({ reason: 'COUPON_NOT_APPLICABLE' });
  });

  it('reports the first-order rule before the zone rule', () => {
    const result = evaluateCoupon(
      coupon({ firstOrderOnly: true, restrictions: [restriction('ZONE', 'zone-9')] }),
      context({ isFirstOrder: false, zoneId: 'zone-1' })
    );

    expect(result).toMatchObject({ reason: 'COUPON_FIRST_ORDER_ONLY' });
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe('purity', () => {
  it('does not mutate its inputs', () => {
    const subject = coupon({ couponType: 'PERCENTAGE', discountValue: 10 });
    const ctx = context();
    const couponBefore = structuredClone(subject);
    const contextBefore = structuredClone(ctx);

    evaluateCoupon(subject, ctx);

    expect(subject).toEqual(couponBefore);
    expect(ctx).toEqual(contextBefore);
  });

  it('returns the same verdict for the same inputs', () => {
    const subject = coupon({ couponType: 'PERCENTAGE', discountValue: 10 });

    expect(evaluateCoupon(subject, context())).toEqual(evaluateCoupon(subject, context()));
  });

  it('depends on the injected clock, never the real one', () => {
    // If this passed with the system clock the engine would be untestable at a
    // boundary — which is the only place expiry bugs live.
    const subject = coupon({ validUntil: new Date('2026-06-14T00:00:00.000Z') });

    expect(
      evaluateCoupon(subject, context({ now: new Date('2026-06-13T00:00:00.000Z') })).isApplicable
    ).toBe(true);
    expect(
      evaluateCoupon(subject, context({ now: new Date('2026-06-15T00:00:00.000Z') })).isApplicable
    ).toBe(false);
  });
});
