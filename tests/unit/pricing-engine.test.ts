import { describe, expect, it } from 'vitest';
import { allocateDiscount, calculatePricing, NO_TAX_STRATEGY } from '@/modules/pricing';
import type { PricingLineInput } from '@/modules/pricing';
import type { ZoneFeeConfig } from '@/modules/location/delivery-fee';

/**
 * Pricing engine tests.
 *
 * docs/ARCHITECTURE.md §16 requires near-exhaustive coverage of this module
 * specifically, because it is the single source of every monetary total and a bug
 * here charges real customers the wrong amount.
 *
 * Every assertion is in integer paise. The seeded Indore zone is the reference:
 * ₹25 delivery, free above ₹199, ₹99 minimum order.
 */

const ZONE: ZoneFeeConfig = {
  baseDeliveryFeePaise: 2_500,
  freeDeliveryThresholdPaise: 19_900,
  minOrderPaise: 9_900,
  perKmFeePaise: null,
  maxDeliveryFeePaise: null,
};

function line(overrides: Partial<PricingLineInput> = {}): PricingLineInput {
  return {
    id: 'line-1',
    variantId: 'variant-1',
    quantity: 1,
    unitPricePaise: 10_000,
    mrpPaise: 10_000,
    categoryId: 'category-1',
    ...overrides,
  };
}

describe('the approved order of operations', () => {
  it('composes gross, discounts, tax and fees into the total', () => {
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 10_000, mrpPaise: 12_000, quantity: 2 })],
      zone: ZONE,
      discount: { couponId: 'c', code: 'X', amountPaise: 2_000, waivesDeliveryFee: false },
      packagingFeePaise: 500,
      serviceFeePaise: 300,
    });

    // gross 20000 − coupon 2000 = taxable 18000, + tax 0 + delivery 2500
    // + packaging 500 + service 300 = 21300
    expect(result.grossAmountPaise).toBe(20_000);
    expect(result.couponDiscountPaise).toBe(2_000);
    expect(result.taxableAmountPaise).toBe(18_000);
    expect(result.taxAmountPaise).toBe(0);
    expect(result.deliveryFeePaise).toBe(2_500);
    expect(result.packagingFeePaise).toBe(500);
    expect(result.serviceFeePaise).toBe(300);
    expect(result.totalAmountPaise).toBe(21_300);
  });

  it('keeps the total equal to the sum of its parts', () => {
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 7_777, quantity: 3 })],
      zone: ZONE,
      packagingFeePaise: 111,
      serviceFeePaise: 222,
    });

    const rebuilt =
      result.taxableAmountPaise +
      result.taxAmountPaise +
      result.deliveryFeePaise +
      result.packagingFeePaise +
      result.serviceFeePaise;

    expect(result.totalAmountPaise).toBe(rebuilt);
  });

  it('counts units and lines separately', () => {
    const result = calculatePricing({
      lines: [
        line({ id: 'a', variantId: 'v1', quantity: 3 }),
        line({ id: 'b', variantId: 'v2', quantity: 2 }),
      ],
      zone: ZONE,
    });

    expect(result.itemCount).toBe(5);
    expect(result.lineCount).toBe(2);
  });

  it('prices an empty cart as zero without throwing', () => {
    const result = calculatePricing({ lines: [], zone: ZONE });

    expect(result.grossAmountPaise).toBe(0);
    // The zone still charges delivery on an empty cart; the UI blocks checkout on
    // the minimum-order flag rather than on a fabricated zero fee.
    expect(result.meetsMinimumOrder).toBe(false);
    expect(result.itemCount).toBe(0);
  });
});

describe('tax (D-14 blocked)', () => {
  it('is always zero', () => {
    const result = calculatePricing({ lines: [line({ unitPricePaise: 99_999 })], zone: ZONE });

    expect(result.taxAmountPaise).toBe(0);
  });

  it('is NOT displayable, so no "₹0 GST" line can render', () => {
    // Rendering a zero tax line would assert that these goods are zero-rated —
    // a claim nobody has authorised.
    const result = calculatePricing({ lines: [line()], zone: ZONE });

    expect(result.isTaxDisplayable).toBe(false);
  });

  it('reports the taxable amount even though tax is zero', () => {
    // The column is populated so unblocking D-14 is a backfill, not a migration.
    const result = calculatePricing({ lines: [line({ unitPricePaise: 15_000 })], zone: ZONE });

    expect(result.taxableAmountPaise).toBe(15_000);
  });

  it('uses the strategy it is given', () => {
    const doubled = {
      name: 'test',
      calculate: (taxable: number) => ({
        taxableAmountPaise: taxable as never,
        taxAmountPaise: (taxable * 2) as never,
        isDisplayable: true,
      }),
    };

    const result = calculatePricing({
      lines: [line({ unitPricePaise: 1_000 })],
      zone: null,
      taxStrategy: doubled,
    });

    // Proves tax is genuinely pluggable rather than hardcoded to zero.
    expect(result.taxAmountPaise).toBe(2_000);
    expect(result.isTaxDisplayable).toBe(true);
  });

  it('defaults to the no-tax strategy', () => {
    expect(NO_TAX_STRATEGY.calculate(10_000 as never).taxAmountPaise).toBe(0);
  });
});

describe('delivery fee (D-17)', () => {
  it('charges the zone fee below the free-delivery threshold', () => {
    const result = calculatePricing({ lines: [line({ unitPricePaise: 15_000 })], zone: ZONE });

    expect(result.deliveryFeePaise).toBe(2_500);
    expect(result.isDeliveryFree).toBe(false);
    expect(result.freeDeliveryGapPaise).toBe(4_900);
  });

  it('waives the fee at the threshold', () => {
    const result = calculatePricing({ lines: [line({ unitPricePaise: 19_900 })], zone: ZONE });

    expect(result.deliveryFeePaise).toBe(0);
    expect(result.isDeliveryFree).toBe(true);
    expect(result.deliveryWaivedBy).toBe('threshold');
  });

  it('uses the POST-DISCOUNT value for the threshold', () => {
    // A ₹210 cart with ₹20 off is ₹190 — below the threshold, so delivery is
    // charged. Using the pre-discount figure would give away free delivery the
    // customer has not earned.
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 21_000 })],
      zone: ZONE,
      discount: { couponId: 'c', code: 'X', amountPaise: 2_000, waivesDeliveryFee: false },
    });

    expect(result.taxableAmountPaise).toBe(19_000);
    expect(result.deliveryFeePaise).toBe(2_500);
  });

  it('lets a coupon carry a cart OVER the threshold without charging delivery', () => {
    // Exactly at the threshold after discount.
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 21_900 })],
      zone: ZONE,
      discount: { couponId: 'c', code: 'X', amountPaise: 2_000, waivesDeliveryFee: false },
    });

    expect(result.taxableAmountPaise).toBe(19_900);
    expect(result.deliveryFeePaise).toBe(0);
  });

  it('waives the fee for a free-delivery coupon below the threshold', () => {
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 12_000 })],
      zone: ZONE,
      discount: { couponId: 'c', code: 'FREEDEL', amountPaise: 0, waivesDeliveryFee: true },
    });

    expect(result.deliveryFeePaise).toBe(0);
    expect(result.deliveryWaivedBy).toBe('coupon');
    // The waiver does not touch the items.
    expect(result.taxableAmountPaise).toBe(12_000);
  });

  it('reports the pre-waiver fee so the saving can be shown', () => {
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 25_000 })],
      zone: ZONE,
    });

    expect(result.deliveryFeeBeforeDiscountPaise).toBe(2_500);
    expect(result.deliveryFeePaise).toBe(0);
  });

  it('adds a per-km component when the zone configures one', () => {
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 10_000 })],
      zone: { ...ZONE, perKmFeePaise: 500 },
      distanceKm: 4,
    });

    // ₹25 base + 4 km × ₹5 = ₹45
    expect(result.deliveryFeePaise).toBe(4_500);
  });

  it('quotes NO fee when the zone is unknown, and says the quote is incomplete', () => {
    // Zero would be a lie: the fee is unknown, not free.
    const result = calculatePricing({ lines: [line()], zone: null });

    expect(result.deliveryFeePaise).toBe(0);
    expect(result.isDeliveryFree).toBe(false);
    expect(result.isQuoteIncomplete).toBe(true);
    expect(result.minOrderPaise).toBeNull();
  });

  it('marks the quote complete when a zone is known', () => {
    expect(calculatePricing({ lines: [line()], zone: ZONE }).isQuoteIncomplete).toBe(false);
  });
});

describe('minimum order', () => {
  it('flags a cart below the zone minimum', () => {
    const result = calculatePricing({ lines: [line({ unitPricePaise: 5_000 })], zone: ZONE });

    expect(result.meetsMinimumOrder).toBe(false);
    expect(result.minimumOrderGapPaise).toBe(4_900);
    expect(result.minOrderPaise).toBe(9_900);
  });

  it('accepts a cart exactly at the minimum', () => {
    const result = calculatePricing({ lines: [line({ unitPricePaise: 9_900 })], zone: ZONE });

    expect(result.meetsMinimumOrder).toBe(true);
    expect(result.minimumOrderGapPaise).toBeNull();
  });

  it('assesses the minimum AFTER discounts', () => {
    // A coupon can push a cart below the minimum, and pretending otherwise would
    // let an order through that the store will not accept.
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 10_500 })],
      zone: ZONE,
      discount: { couponId: 'c', code: 'X', amountPaise: 2_000, waivesDeliveryFee: false },
    });

    expect(result.taxableAmountPaise).toBe(8_500);
    expect(result.meetsMinimumOrder).toBe(false);
  });
});

describe('coupon discount', () => {
  it('never exceeds the item value', () => {
    // Otherwise the total goes negative and we owe the customer money.
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 5_000 })],
      zone: ZONE,
      discount: { couponId: 'c', code: 'X', amountPaise: 999_999, waivesDeliveryFee: false },
    });

    expect(result.couponDiscountPaise).toBe(5_000);
    expect(result.taxableAmountPaise).toBe(0);
    expect(result.totalAmountPaise).toBe(2_500); // delivery only
  });

  it('never makes the total negative', () => {
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 100 })],
      zone: null,
      discount: { couponId: 'c', code: 'X', amountPaise: 999_999, waivesDeliveryFee: false },
    });

    expect(result.totalAmountPaise).toBeGreaterThanOrEqual(0);
  });

  it('does NOT eat into the delivery fee', () => {
    // A cart discount applies to goods. Delivery is waived by a FREE_DELIVERY
    // coupon, which is a different mechanism.
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 3_000 })],
      zone: ZONE,
      discount: { couponId: 'c', code: 'X', amountPaise: 10_000, waivesDeliveryFee: false },
    });

    expect(result.couponDiscountPaise).toBe(3_000);
    expect(result.deliveryFeePaise).toBe(2_500);
  });

  it('applies no discount when none is given', () => {
    const result = calculatePricing({ lines: [line()], zone: ZONE });

    expect(result.couponDiscountPaise).toBe(0);
    expect(result.lines[0]!.couponDiscountPaise).toBe(0);
  });
});

describe('discount allocation across lines', () => {
  it('splits proportionally', () => {
    expect(allocateDiscount([10_000, 10_000], 1_000)).toEqual([500, 500]);
  });

  it('sums EXACTLY to the discount even when it does not divide evenly', () => {
    // The classic bug: three lines and 100 paise, rounded per line, loses a paisa
    // and the parts no longer equal the whole.
    const shares = allocateDiscount([10_000, 10_000, 10_000], 100);

    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100);
  });

  it('gives the remainder to the largest line', () => {
    const shares = allocateDiscount([30_000, 10_000, 10_000], 100);

    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100);
    expect(shares[0]).toBeGreaterThan(shares[1]!);
  });

  it('weights by line value, not line count', () => {
    const shares = allocateDiscount([90_000, 10_000], 1_000);

    expect(shares).toEqual([900, 100]);
  });

  it('caps allocation at the total available', () => {
    const shares = allocateDiscount([1_000, 1_000], 99_999);

    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(2_000);
  });

  it('never allocates more to a line than the line is worth', () => {
    const values = [10, 10_000];
    const shares = allocateDiscount(values, 10_005);

    expect(shares[0]).toBeLessThanOrEqual(values[0]!);
    expect(shares[1]).toBeLessThanOrEqual(values[1]!);
  });

  it('returns zeroes for a zero discount', () => {
    expect(allocateDiscount([10_000, 5_000], 0)).toEqual([0, 0]);
  });

  it('returns zeroes for an empty cart', () => {
    expect(allocateDiscount([], 1_000)).toEqual([]);
  });

  it('handles a zero-value cart without dividing by zero', () => {
    expect(allocateDiscount([0, 0], 1_000)).toEqual([0, 0]);
  });

  it('matches the cart-level discount in a real pricing run', () => {
    const result = calculatePricing({
      lines: [
        line({ id: 'a', variantId: 'v1', unitPricePaise: 28_900 }),
        line({ id: 'b', variantId: 'v2', unitPricePaise: 17_500 }),
        line({ id: 'c', variantId: 'v3', unitPricePaise: 7_200 }),
      ],
      zone: ZONE,
      discount: { couponId: 'c', code: 'X', amountPaise: 5_000, waivesDeliveryFee: false },
    });

    const allocated = result.lines.reduce((sum, l) => sum + l.couponDiscountPaise, 0);
    expect(allocated).toBe(result.couponDiscountPaise);
  });
});

describe('line pricing', () => {
  it('multiplies unit price by quantity', () => {
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 7_200, quantity: 3 })],
      zone: ZONE,
    });

    expect(result.lines[0]!.grossPaise).toBe(21_600);
  });

  it('reports MRP savings per line', () => {
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 28_900, mrpPaise: 32_500, quantity: 2 })],
      zone: ZONE,
    });

    // (32500 − 28900) × 2
    expect(result.lines[0]!.savingsPaise).toBe(7_200);
  });

  it('reports no savings when price equals MRP', () => {
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 7_200, mrpPaise: 7_200 })],
      zone: ZONE,
    });

    expect(result.lines[0]!.savingsPaise).toBe(0);
  });

  it('never reports negative savings when price exceeds MRP', () => {
    // Bad data must not become a negative "saving" on screen.
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 12_000, mrpPaise: 10_000 })],
      zone: ZONE,
    });

    expect(result.lines[0]!.savingsPaise).toBe(0);
  });

  it('echoes the line id so results can be matched back', () => {
    const result = calculatePricing({
      lines: [line({ id: 'cart-item-42' })],
      zone: ZONE,
    });

    expect(result.lines[0]!.id).toBe('cart-item-42');
  });

  it('totals savings across MRP, coupon and delivery', () => {
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 28_900, mrpPaise: 32_500 })],
      zone: ZONE,
      discount: { couponId: 'c', code: 'X', amountPaise: 1_000, waivesDeliveryFee: true },
    });

    // 3600 MRP + 1000 coupon + 2500 delivery waived
    expect(result.totalSavingsPaise).toBe(7_100);
  });
});

describe('input validation', () => {
  it('rejects a fractional unit price', () => {
    // Fractional paise means someone passed rupees.
    expect(() =>
      calculatePricing({ lines: [line({ unitPricePaise: 199.5 })], zone: ZONE })
    ).toThrow(TypeError);
  });

  it('rejects a negative unit price', () => {
    expect(() => calculatePricing({ lines: [line({ unitPricePaise: -100 })], zone: ZONE })).toThrow(
      TypeError
    );
  });

  it('rejects a zero or negative quantity', () => {
    expect(() => calculatePricing({ lines: [line({ quantity: 0 })], zone: ZONE })).toThrow(
      TypeError
    );
    expect(() => calculatePricing({ lines: [line({ quantity: -1 })], zone: ZONE })).toThrow(
      TypeError
    );
  });

  it('rejects a fractional quantity', () => {
    expect(() => calculatePricing({ lines: [line({ quantity: 1.5 })], zone: ZONE })).toThrow(
      TypeError
    );
  });

  it('rejects a negative discount', () => {
    expect(() =>
      calculatePricing({
        lines: [line()],
        zone: ZONE,
        discount: { couponId: 'c', code: 'X', amountPaise: -500, waivesDeliveryFee: false },
      })
    ).toThrow(TypeError);
  });

  it('rejects fractional packaging or service fees', () => {
    expect(() =>
      calculatePricing({ lines: [line()], zone: ZONE, packagingFeePaise: 10.5 })
    ).toThrow(TypeError);
  });
});

describe('fees with no configuration source', () => {
  it('defaults packaging and service fees to zero', () => {
    // The `orders` columns exist but nothing configures the values, so they are
    // zero rather than invented.
    const result = calculatePricing({ lines: [line()], zone: ZONE });

    expect(result.packagingFeePaise).toBe(0);
    expect(result.serviceFeePaise).toBe(0);
  });

  it('includes them in the total when supplied', () => {
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 20_000 })],
      zone: ZONE,
      packagingFeePaise: 1_000,
      serviceFeePaise: 500,
    });

    // 20000 items + 0 delivery (over threshold) + 1000 + 500
    expect(result.totalAmountPaise).toBe(21_500);
  });
});

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    const input = {
      lines: [line({ unitPricePaise: 28_900, quantity: 2 })],
      zone: ZONE,
      discount: { couponId: 'c', code: 'X', amountPaise: 1_234, waivesDeliveryFee: false },
    };

    // No clock, no randomness, no I/O — the same cart must always cost the same.
    expect(calculatePricing(input)).toEqual(calculatePricing(input));
  });

  it('returns integer paise for every monetary field', () => {
    const result = calculatePricing({
      lines: [line({ unitPricePaise: 3_333, quantity: 7 })],
      zone: { ...ZONE, perKmFeePaise: 333 },
      distanceKm: 3.7,
      discount: { couponId: 'c', code: 'X', amountPaise: 777, waivesDeliveryFee: false },
      packagingFeePaise: 99,
      serviceFeePaise: 11,
    });

    for (const [key, value] of Object.entries(result)) {
      if (typeof value === 'number') {
        expect(Number.isInteger(value), `${key} must be an integer`).toBe(true);
      }
    }
  });
});
