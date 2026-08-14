import { addPaise, paise, subtractPaise, type Paise } from '@/lib/money';

/**
 * Delivery fee calculation (decision D-17).
 *
 * D-17 approved: **zone-based delivery fee with a ₹199 free-delivery threshold as
 * the initial business rule, fully admin-configurable per zone.**
 *
 * Every input therefore comes from the zone row — nothing here is a constant.
 * `delivery_zones` carries `base_delivery_fee_paise`, `free_delivery_threshold_paise`,
 * `min_order_paise`, `per_km_fee_paise` and `max_delivery_fee_paise`, all editable
 * by an admin.
 *
 * This module is PURE: no database, no clock, no provider. That is what makes it
 * exhaustively testable, and delivery fees are exactly the kind of arithmetic that
 * must never be re-derived in a component or a route handler.
 *
 * NOTE ON SCOPE: this computes the DELIVERY FEE only. Cart totals, coupons and tax
 * belong to the pricing module (TASK 008), and tax specifically remains blocked by
 * D-14.
 */

/** Fee configuration for a zone, as stored in `delivery_zones`. */
export interface ZoneFeeConfig {
  baseDeliveryFeePaise: number;
  /** Order value at or above which delivery is free. `null` disables the waiver. */
  freeDeliveryThresholdPaise: number | null;
  minOrderPaise: number;
  /** Distance component, applied beyond `freeDistanceKm`. `null` disables it. */
  perKmFeePaise: number | null;
  /** Upper bound on the total fee. `null` means uncapped. */
  maxDeliveryFeePaise: number | null;
}

export interface DeliveryFeeInput {
  zone: ZoneFeeConfig;
  /** Order value before delivery, packaging and service fees, in paise. */
  orderValuePaise: number;
  /** Road distance from the store, when known. Straight-line must not be used. */
  distanceKm?: number | null;
}

export interface DeliveryFeeResult {
  /** The fee payable, in paise. */
  feePaise: Paise;
  /** Fee before any waiver, so the UI can show the saving honestly. */
  baseFeePaise: Paise;
  /** Distance component included in `baseFeePaise`. */
  distanceFeePaise: Paise;
  /** True when the threshold waived the fee entirely. */
  isFreeDelivery: boolean;
  /**
   * Amount still needed to qualify for free delivery, or `null` when already free
   * or when the zone has no threshold. Powers "add ₹120 more for free delivery".
   */
  freeDeliveryGapPaise: Paise | null;
  /** Whether the order meets the zone minimum. */
  meetsMinimumOrder: boolean;
  /** Shortfall against the zone minimum, or `null` when satisfied. */
  minimumOrderGapPaise: Paise | null;
}

/**
 * Distance included in the base fee before per-km charging begins.
 *
 * NOT a business rule invented here: it is the neutral default used when a zone
 * sets `per_km_fee_paise`, and the seeded zone leaves that null so the default is
 * inert. Making it a zone column requires a product decision (see the note in the
 * PR); until then a per-km zone charges from the first kilometre.
 */
const INCLUDED_DISTANCE_KM = 0;

export function calculateDeliveryFee(input: DeliveryFeeInput): DeliveryFeeResult {
  const { zone, orderValuePaise } = input;

  assertNonNegative(orderValuePaise, 'orderValuePaise');
  assertNonNegative(zone.baseDeliveryFeePaise, 'baseDeliveryFeePaise');
  assertNonNegative(zone.minOrderPaise, 'minOrderPaise');

  // ---- Distance component ----
  const distanceKm = input.distanceKm ?? null;
  let distanceFee = paise(0);

  if (zone.perKmFeePaise !== null && zone.perKmFeePaise > 0 && distanceKm !== null) {
    if (!Number.isFinite(distanceKm) || distanceKm < 0) {
      throw new TypeError(
        `distanceKm must be a non-negative finite number, received ${distanceKm}`
      );
    }

    const chargeableKm = Math.max(0, distanceKm - INCLUDED_DISTANCE_KM);
    // Rounded to whole paise, half-up, matching every other money calculation.
    distanceFee = paise(Math.round(chargeableKm * zone.perKmFeePaise));
  }

  const uncappedBase = addPaise(paise(zone.baseDeliveryFeePaise), distanceFee);

  // ---- Cap ----
  const baseFee =
    zone.maxDeliveryFeePaise !== null && uncappedBase > zone.maxDeliveryFeePaise
      ? paise(zone.maxDeliveryFeePaise)
      : uncappedBase;

  // ---- Free-delivery threshold ----
  const threshold = zone.freeDeliveryThresholdPaise;
  const qualifiesForFree = threshold !== null && orderValuePaise >= threshold;

  const feePaise = qualifiesForFree ? paise(0) : baseFee;

  // Gap is null when already free, when there is no threshold, or when the fee is
  // zero anyway — offering "spend more for free delivery" on a free order is
  // nonsense.
  const freeDeliveryGapPaise =
    threshold === null || qualifiesForFree || baseFee === 0
      ? null
      : subtractPaise(paise(threshold), paise(orderValuePaise));

  // ---- Minimum order ----
  const meetsMinimumOrder = orderValuePaise >= zone.minOrderPaise;
  const minimumOrderGapPaise = meetsMinimumOrder
    ? null
    : subtractPaise(paise(zone.minOrderPaise), paise(orderValuePaise));

  return {
    feePaise,
    baseFeePaise: baseFee,
    distanceFeePaise: distanceFee,
    isFreeDelivery: qualifiesForFree || feePaise === 0,
    freeDeliveryGapPaise,
    meetsMinimumOrder,
    minimumOrderGapPaise,
  };
}

/**
 * Estimated delivery window in minutes.
 *
 * Combines the zone's configured average with the travel time the routing
 * provider reported, plus store preparation time. Returns a range rather than a
 * single number, because a precise-looking ETA that is routinely wrong erodes
 * trust faster than an honest window.
 */
export function estimateDeliveryWindow(input: {
  zoneAvgMinutes: number | null;
  routeDurationSeconds: number | null;
  storePrepMinutes: number | null;
}): { minMinutes: number; maxMinutes: number } | null {
  const travelMinutes =
    input.routeDurationSeconds !== null ? Math.ceil(input.routeDurationSeconds / 60) : null;

  const prepMinutes = input.storePrepMinutes ?? 0;

  // Prefer measured travel time; fall back to the zone average.
  const baseMinutes =
    travelMinutes !== null ? travelMinutes + prepMinutes : (input.zoneAvgMinutes ?? null);

  if (baseMinutes === null) return null;

  return {
    minMinutes: Math.max(5, Math.round(baseMinutes * 0.8)),
    maxMinutes: Math.max(10, Math.round(baseMinutes * 1.25)),
  };
}

function assertNonNegative(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer in paise, received ${value}`);
  }
}
