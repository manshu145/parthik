import { addPaise, paise, subtractPaise, multiplyPaise, ZERO_PAISE, type Paise } from '@/lib/money';
import { calculateDeliveryFee } from '@/modules/location/delivery-fee';
import { NO_TAX_STRATEGY } from './tax-strategy';
import type {
  AppliedDiscount,
  PricedLine,
  PricingInput,
  PricingLineInput,
  PricingResult,
} from './pricing.types';

/**
 * The pricing engine (docs/ARCHITECTURE.md §11.2, docs/DATABASE.md §1.1).
 *
 * ONE code path produces every total in the system — cart preview, checkout quote,
 * order creation and admin re-quoting. That is the whole point: two
 * implementations of "what does this cost" is how a customer gets charged one
 * number and shown another.
 *
 * PURE. No database, no clock, no provider, no I/O. Every input is passed in, so
 * the rules can be tested exhaustively, which docs/ARCHITECTURE.md §16 requires of
 * this module specifically.
 *
 * THE APPROVED ORDER OF OPERATIONS (docs/DATABASE.md §1.1) — not rearrangeable,
 * because each step's output is the next step's input:
 *
 *     gross                 unit price × quantity, pre-discount
 *   − item discount         product / promotion level
 *   − coupon discount       cart level, allocated across lines
 *   = taxable
 *   + tax                   D-14: always zero
 *   + delivery fee          D-17, zone configured
 *   + packaging fee
 *   + service fee
 *   = total
 *
 * All money is integer paise. `lib/money.ts` owns rounding (half-up), so nothing
 * here rounds independently — inconsistent rounding is how totals stop reconciling
 * with payments.
 */

/** Guards against a caller passing rupees, or a negative, as an amount. */
function assertAmount(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer number of paise, received ${value}.`);
  }
  if (value < 0) {
    throw new TypeError(`${label} cannot be negative, received ${value}.`);
  }
}

function assertQuantity(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer, received ${value}.`);
  }
}

/**
 * Splits a cart-level discount across lines proportionally to their value.
 *
 * WHY IT IS NOT A SIMPLE `Math.round` PER LINE: rounding each share independently
 * loses or gains paise, so the line shares stop summing to the discount actually
 * deducted from the total. The remainder is therefore given to the largest line,
 * which guarantees the parts equal the whole exactly.
 *
 * Returns shares in the same order as the input.
 */
export function allocateDiscount(
  lineValuesPaise: readonly number[],
  discountPaise: number
): number[] {
  const total = lineValuesPaise.reduce((sum, value) => sum + value, 0);

  if (discountPaise <= 0 || total <= 0) return lineValuesPaise.map(() => 0);

  // A discount can never exceed what there is to discount.
  const capped = Math.min(discountPaise, total);

  const shares = lineValuesPaise.map((value) => Math.floor((value * capped) / total));
  const allocated = shares.reduce((sum, share) => sum + share, 0);
  let remainder = capped - allocated;

  if (remainder > 0) {
    // Largest line first, so the adjustment lands where it is least visible.
    const order = lineValuesPaise
      .map((value, index) => ({ value, index }))
      .sort((a, b) => b.value - a.value || a.index - b.index);

    for (const { index } of order) {
      if (remainder === 0) break;
      // Never allocate more to a line than the line is worth.
      if (shares[index]! < lineValuesPaise[index]!) {
        shares[index] = shares[index]! + 1;
        remainder -= 1;
      }
    }
  }

  return shares;
}

function priceLine(line: PricingLineInput): {
  gross: Paise;
  itemDiscount: Paise;
  savings: Paise;
} {
  assertQuantity(line.quantity, 'quantity');
  assertAmount(line.unitPricePaise, 'unitPricePaise');
  assertAmount(line.mrpPaise, 'mrpPaise');

  const gross = multiplyPaise(paise(line.unitPricePaise), line.quantity);

  // Item discount is the MRP-to-price gap, which is how the catalogue expresses a
  // product-level discount today. Promotions add to this in TASK 012 without
  // changing the shape.
  const perUnitSaving = Math.max(0, line.mrpPaise - line.unitPricePaise);
  const savings = multiplyPaise(paise(perUnitSaving), line.quantity);

  return { gross, itemDiscount: ZERO_PAISE, savings };
}

export function calculatePricing(input: PricingInput): PricingResult {
  const taxStrategy = input.taxStrategy ?? NO_TAX_STRATEGY;
  const discount: AppliedDiscount | null = input.discount ?? null;

  const packagingFeePaise = paise(input.packagingFeePaise ?? 0);
  const serviceFeePaise = paise(input.serviceFeePaise ?? 0);
  assertAmount(packagingFeePaise, 'packagingFeePaise');
  assertAmount(serviceFeePaise, 'serviceFeePaise');

  // ---- Lines ----
  const priced = input.lines.map((line) => ({ line, ...priceLine(line) }));

  const grossAmountPaise = priced.reduce((sum, entry) => addPaise(sum, entry.gross), ZERO_PAISE);
  const itemDiscountPaise = priced.reduce(
    (sum, entry) => addPaise(sum, entry.itemDiscount),
    ZERO_PAISE
  );

  const afterItemDiscount = subtractPaise(grossAmountPaise, itemDiscountPaise);

  // ---- Coupon ----
  if (discount) assertAmount(discount.amountPaise, 'discount.amountPaise');

  // A scoped coupon may only be allocated across the lines it actually covers.
  // Null means the whole cart.
  const eligibleIds = discount?.eligibleLineIds ? new Set(discount.eligibleLineIds) : null;

  const lineValues = priced.map((entry) => entry.gross - entry.itemDiscount);
  // Ineligible lines are given a zero weight, so they receive no share.
  const allocatableValues = priced.map((entry, index) =>
    eligibleIds && !eligibleIds.has(entry.line.id) ? 0 : lineValues[index]!
  );
  const allocatableTotal = allocatableValues.reduce((sum, value) => sum + value, 0);

  // Capped at the value it may apply to: a coupon must never make items negative,
  // must never eat into the delivery fee (a FREE_DELIVERY coupon waives that
  // instead), and a scoped coupon must never exceed the lines it covers.
  const couponDiscountPaise = paise(Math.min(discount?.amountPaise ?? 0, allocatableTotal));

  const couponShares = allocateDiscount(allocatableValues, couponDiscountPaise);

  const lines: PricedLine[] = priced.map((entry, index) => ({
    id: entry.line.id,
    variantId: entry.line.variantId,
    quantity: entry.line.quantity,
    unitPricePaise: paise(entry.line.unitPricePaise),
    mrpPaise: paise(entry.line.mrpPaise),
    grossPaise: entry.gross,
    itemDiscountPaise: entry.itemDiscount,
    couponDiscountPaise: paise(couponShares[index] ?? 0),
    lineTotalPaise: subtractPaise(entry.gross, entry.itemDiscount),
    savingsPaise: entry.savings,
  }));

  const taxableAmountPaise = subtractPaise(afterItemDiscount, couponDiscountPaise);

  // ---- Tax (D-14: zero, and not displayable) ----
  const tax = taxStrategy.calculate(taxableAmountPaise);

  // ---- Delivery (D-17) ----
  // The zone engine is given the value AFTER discounts, so a coupon can carry a
  // cart over the free-delivery threshold. Charging delivery on a discounted cart
  // that now qualifies would be indefensible to the customer.
  let deliveryFeePaise = ZERO_PAISE;
  let deliveryFeeBeforeDiscountPaise = ZERO_PAISE;
  let freeDeliveryGapPaise: Paise | null = null;
  let meetsMinimumOrder = true;
  let minimumOrderGapPaise: Paise | null = null;
  let minOrderPaise: Paise | null = null;
  let waivedByThreshold = false;

  if (input.zone) {
    const fee = calculateDeliveryFee({
      zone: input.zone,
      orderValuePaise: taxableAmountPaise,
      ...(input.distanceKm !== undefined ? { distanceKm: input.distanceKm } : {}),
    });

    deliveryFeePaise = fee.feePaise;
    deliveryFeeBeforeDiscountPaise = fee.baseFeePaise;
    freeDeliveryGapPaise = fee.freeDeliveryGapPaise;
    meetsMinimumOrder = fee.meetsMinimumOrder;
    minimumOrderGapPaise = fee.minimumOrderGapPaise;
    minOrderPaise = paise(input.zone.minOrderPaise);
    waivedByThreshold = fee.isFreeDelivery && fee.baseFeePaise > 0;
  }

  // An approved FREE_DELIVERY coupon or promotion waives whatever remains.
  const waivedByDiscount = Boolean(discount?.waivesDeliveryFee) && deliveryFeePaise > 0;
  if (waivedByDiscount) deliveryFeePaise = ZERO_PAISE;

  const isDeliveryFree = input.zone !== null && deliveryFeePaise === 0;
  const deliveryWaivedBy = !isDeliveryFree
    ? null
    : waivedByDiscount
      ? (discount?.deliveryWaiverSource ?? 'coupon')
      : waivedByThreshold
        ? 'threshold'
        : // The zone simply charges nothing.
          'zone';

  // ---- Total ----
  const totalAmountPaise = addPaise(
    taxableAmountPaise,
    tax.taxAmountPaise,
    deliveryFeePaise,
    packagingFeePaise,
    serviceFeePaise
  );

  const mrpSavings = lines.reduce((sum, line) => addPaise(sum, line.savingsPaise), ZERO_PAISE);
  const deliverySaving = subtractPaise(deliveryFeeBeforeDiscountPaise, deliveryFeePaise);

  return {
    lines,
    itemCount: input.lines.reduce((sum, line) => sum + line.quantity, 0),
    lineCount: input.lines.length,

    grossAmountPaise,
    itemDiscountPaise,
    couponDiscountPaise,
    taxableAmountPaise,
    taxAmountPaise: tax.taxAmountPaise,
    isTaxDisplayable: tax.isDisplayable,

    deliveryFeePaise,
    deliveryFeeBeforeDiscountPaise,
    isDeliveryFree,
    deliveryWaivedBy,

    packagingFeePaise,
    serviceFeePaise,
    totalAmountPaise,

    totalSavingsPaise: addPaise(mrpSavings, couponDiscountPaise, deliverySaving),

    freeDeliveryGapPaise,
    meetsMinimumOrder,
    minimumOrderGapPaise,
    minOrderPaise,

    // A cart with no zone cannot be quoted: the customer has not chosen a
    // serviceable location yet, so fees are unknown rather than zero.
    isQuoteIncomplete: input.zone === null,
  };
}
