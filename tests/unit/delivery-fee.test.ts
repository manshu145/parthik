import { describe, expect, it } from 'vitest';
import {
  calculateDeliveryFee,
  estimateDeliveryWindow,
  type ZoneFeeConfig,
} from '@/modules/location/delivery-fee';

/**
 * Delivery fee tests (D-17).
 *
 * The seeded zone is the reference case: ₹25 base fee, free above ₹199, ₹99
 * minimum order. Values are asserted in paise because that is the storage unit and
 * an off-by-100 error here is a real, expensive class of bug.
 */

/** Mirrors DELIVERY_ZONES[0] in db/seed/reference-data.ts. */
const SEEDED_ZONE: ZoneFeeConfig = {
  baseDeliveryFeePaise: 2_500,
  freeDeliveryThresholdPaise: 19_900,
  minOrderPaise: 9_900,
  perKmFeePaise: null,
  maxDeliveryFeePaise: null,
};

describe('calculateDeliveryFee — free delivery threshold', () => {
  it('charges the base fee below the threshold', () => {
    const result = calculateDeliveryFee({ zone: SEEDED_ZONE, orderValuePaise: 15_000 });

    expect(result.feePaise).toBe(2_500);
    expect(result.isFreeDelivery).toBe(false);
  });

  it('waives the fee exactly AT the threshold, not only above it', () => {
    // Boundary case. "Free delivery above ₹199" is universally read as ₹199
    // qualifying; charging at exactly ₹199 would be a support complaint.
    const result = calculateDeliveryFee({ zone: SEEDED_ZONE, orderValuePaise: 19_900 });

    expect(result.feePaise).toBe(0);
    expect(result.isFreeDelivery).toBe(true);
  });

  it('waives the fee above the threshold', () => {
    const result = calculateDeliveryFee({ zone: SEEDED_ZONE, orderValuePaise: 50_000 });

    expect(result.feePaise).toBe(0);
    expect(result.isFreeDelivery).toBe(true);
  });

  it('still reports the base fee when waived, so the saving can be shown', () => {
    const result = calculateDeliveryFee({ zone: SEEDED_ZONE, orderValuePaise: 25_000 });

    expect(result.feePaise).toBe(0);
    expect(result.baseFeePaise).toBe(2_500);
  });

  it('reports the exact gap to free delivery', () => {
    const result = calculateDeliveryFee({ zone: SEEDED_ZONE, orderValuePaise: 18_000 });

    // ₹199 − ₹180 = ₹19
    expect(result.freeDeliveryGapPaise).toBe(1_900);
  });

  it('reports no gap once free delivery is reached', () => {
    const result = calculateDeliveryFee({ zone: SEEDED_ZONE, orderValuePaise: 20_000 });

    expect(result.freeDeliveryGapPaise).toBeNull();
  });

  it('reports no gap when the zone has no threshold', () => {
    const zone: ZoneFeeConfig = { ...SEEDED_ZONE, freeDeliveryThresholdPaise: null };
    const result = calculateDeliveryFee({ zone, orderValuePaise: 100_000 });

    expect(result.feePaise).toBe(2_500);
    expect(result.isFreeDelivery).toBe(false);
    expect(result.freeDeliveryGapPaise).toBeNull();
  });

  it('reports no gap when delivery is already free of charge', () => {
    // A zone with a zero base fee: prompting "spend more for free delivery" when
    // delivery already costs nothing would be nonsense.
    const zone: ZoneFeeConfig = { ...SEEDED_ZONE, baseDeliveryFeePaise: 0 };
    const result = calculateDeliveryFee({ zone, orderValuePaise: 1_000 });

    expect(result.feePaise).toBe(0);
    expect(result.isFreeDelivery).toBe(true);
    expect(result.freeDeliveryGapPaise).toBeNull();
  });
});

describe('calculateDeliveryFee — minimum order', () => {
  it('flags an order below the zone minimum', () => {
    const result = calculateDeliveryFee({ zone: SEEDED_ZONE, orderValuePaise: 5_000 });

    expect(result.meetsMinimumOrder).toBe(false);
    // ₹99 − ₹50 = ₹49
    expect(result.minimumOrderGapPaise).toBe(4_900);
  });

  it('accepts an order exactly at the minimum', () => {
    const result = calculateDeliveryFee({ zone: SEEDED_ZONE, orderValuePaise: 9_900 });

    expect(result.meetsMinimumOrder).toBe(true);
    expect(result.minimumOrderGapPaise).toBeNull();
  });

  it('reports the minimum-order shortfall independently of the fee', () => {
    // Below the minimum, the fee is still computed — the caller decides whether to
    // block checkout. Conflating the two would hide one of the two problems.
    const result = calculateDeliveryFee({ zone: SEEDED_ZONE, orderValuePaise: 1_000 });

    expect(result.feePaise).toBe(2_500);
    expect(result.meetsMinimumOrder).toBe(false);
  });
});

describe('calculateDeliveryFee — distance component', () => {
  const perKmZone: ZoneFeeConfig = { ...SEEDED_ZONE, perKmFeePaise: 500 };

  it('ignores distance when the zone has no per-km fee', () => {
    const result = calculateDeliveryFee({
      zone: SEEDED_ZONE,
      orderValuePaise: 10_000,
      distanceKm: 8,
    });

    expect(result.distanceFeePaise).toBe(0);
    expect(result.feePaise).toBe(2_500);
  });

  it('adds a per-km charge when the zone configures one', () => {
    const result = calculateDeliveryFee({
      zone: perKmZone,
      orderValuePaise: 10_000,
      distanceKm: 4,
    });

    // ₹25 base + (4 km × ₹5) = ₹45
    expect(result.distanceFeePaise).toBe(2_000);
    expect(result.feePaise).toBe(4_500);
  });

  it('rounds a fractional distance charge to whole paise', () => {
    const result = calculateDeliveryFee({
      zone: perKmZone,
      orderValuePaise: 10_000,
      distanceKm: 3.456,
    });

    // 3.456 × 500 = 1728 paise exactly
    expect(result.distanceFeePaise).toBe(1_728);
    expect(Number.isInteger(result.feePaise)).toBe(true);
  });

  it('ignores distance when it is unknown', () => {
    const result = calculateDeliveryFee({
      zone: perKmZone,
      orderValuePaise: 10_000,
      distanceKm: null,
    });

    expect(result.distanceFeePaise).toBe(0);
    expect(result.feePaise).toBe(2_500);
  });

  it('waives a distance-based fee entirely above the threshold', () => {
    const result = calculateDeliveryFee({
      zone: perKmZone,
      orderValuePaise: 30_000,
      distanceKm: 10,
    });

    expect(result.feePaise).toBe(0);
    // Base still reported, so the customer sees what was saved.
    expect(result.baseFeePaise).toBe(7_500);
  });

  it('rejects a negative distance rather than crediting the customer', () => {
    expect(() =>
      calculateDeliveryFee({ zone: perKmZone, orderValuePaise: 10_000, distanceKm: -5 })
    ).toThrow(TypeError);
  });

  it('rejects a non-finite distance', () => {
    expect(() =>
      calculateDeliveryFee({
        zone: perKmZone,
        orderValuePaise: 10_000,
        distanceKm: Number.POSITIVE_INFINITY,
      })
    ).toThrow(TypeError);
  });
});

describe('calculateDeliveryFee — cap', () => {
  it('caps the total fee at the configured maximum', () => {
    const zone: ZoneFeeConfig = {
      ...SEEDED_ZONE,
      perKmFeePaise: 1_000,
      maxDeliveryFeePaise: 6_000,
    };

    const result = calculateDeliveryFee({ zone, orderValuePaise: 10_000, distanceKm: 20 });

    // Uncapped would be ₹25 + ₹200 = ₹225; the cap holds it at ₹60.
    expect(result.feePaise).toBe(6_000);
    expect(result.baseFeePaise).toBe(6_000);
  });

  it('leaves a fee below the cap untouched', () => {
    const zone: ZoneFeeConfig = { ...SEEDED_ZONE, maxDeliveryFeePaise: 10_000 };
    const result = calculateDeliveryFee({ zone, orderValuePaise: 10_000 });

    expect(result.feePaise).toBe(2_500);
  });
});

describe('calculateDeliveryFee — input validation', () => {
  it('rejects a fractional order value', () => {
    // Fractional paise means someone passed rupees. Failing loudly here catches a
    // 100x error at the boundary instead of on an invoice.
    expect(() => calculateDeliveryFee({ zone: SEEDED_ZONE, orderValuePaise: 199.5 })).toThrow(
      TypeError
    );
  });

  it('rejects a negative order value', () => {
    expect(() => calculateDeliveryFee({ zone: SEEDED_ZONE, orderValuePaise: -100 })).toThrow(
      TypeError
    );
  });

  it('accepts a zero order value', () => {
    // An empty cart is legitimate: the UI advertises the base rate before anything
    // has been added.
    const result = calculateDeliveryFee({ zone: SEEDED_ZONE, orderValuePaise: 0 });

    expect(result.feePaise).toBe(2_500);
    expect(result.meetsMinimumOrder).toBe(false);
  });
});

describe('estimateDeliveryWindow', () => {
  it('prefers measured travel time over the zone average', () => {
    const window = estimateDeliveryWindow({
      zoneAvgMinutes: 35,
      routeDurationSeconds: 600, // 10 min
      storePrepMinutes: 10,
    });

    // 10 travel + 10 prep = 20 → 16..25
    expect(window).toEqual({ minMinutes: 16, maxMinutes: 25 });
  });

  it('falls back to the zone average when no route is available', () => {
    const window = estimateDeliveryWindow({
      zoneAvgMinutes: 35,
      routeDurationSeconds: null,
      storePrepMinutes: 10,
    });

    expect(window).toEqual({ minMinutes: 28, maxMinutes: 44 });
  });

  it('returns null when nothing is known', () => {
    // Better to show no ETA than an invented one.
    expect(
      estimateDeliveryWindow({
        zoneAvgMinutes: null,
        routeDurationSeconds: null,
        storePrepMinutes: null,
      })
    ).toBeNull();
  });

  it('never returns an implausibly short window', () => {
    const window = estimateDeliveryWindow({
      zoneAvgMinutes: null,
      routeDurationSeconds: 60,
      storePrepMinutes: 0,
    });

    // A "1 minute" delivery promise is not credible even if the maths says so.
    expect(window?.minMinutes).toBeGreaterThanOrEqual(5);
    expect(window?.maxMinutes).toBeGreaterThanOrEqual(10);
  });

  it('returns a range, never a single point estimate', () => {
    const window = estimateDeliveryWindow({
      zoneAvgMinutes: 35,
      routeDurationSeconds: null,
      storePrepMinutes: null,
    });

    expect(window!.maxMinutes).toBeGreaterThan(window!.minMinutes);
  });
});
