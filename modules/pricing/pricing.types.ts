import type { Paise } from '@/lib/money';
import type { ZoneFeeConfig } from '@/modules/location/delivery-fee';
import type { TaxStrategy } from './tax-strategy';

/**
 * Pricing contract.
 *
 * Field names mirror the `orders` columns exactly (`gross_amount_paise`,
 * `item_discount_paise`, …) so the engine's output maps to a stored order snapshot
 * without a translation layer where a field could be silently mismatched.
 */

/** One cart line, priced from SERVER-read values. Never from client input. */
export interface PricingLineInput {
  /** Cart item id, echoed back so the caller can match results to lines. */
  id: string;
  variantId: string;
  quantity: number;
  /** Authoritative price, re-read from `product_variants.price_paise`. */
  unitPricePaise: number;
  /** Used only to report savings; never part of the payable total. */
  mrpPaise: number;
  categoryId: string;
}

export interface PricedLine {
  id: string;
  variantId: string;
  quantity: number;
  unitPricePaise: Paise;
  mrpPaise: Paise;
  /** unitPrice × quantity, before any discount. */
  grossPaise: Paise;
  /** Product/promotion level discount for this line. */
  itemDiscountPaise: Paise;
  /**
   * This line's share of the cart-level coupon discount.
   *
   * Allocated proportionally so the sum of line shares equals the cart discount
   * exactly — see `allocateDiscount`. Stored nowhere in V1 (`order_items` has no
   * coupon column) but needed to show per-line savings honestly.
   */
  couponDiscountPaise: Paise;
  /** gross − itemDiscount. Coupon is a cart-level concern. */
  lineTotalPaise: Paise;
  /** MRP saving, for the "you saved" figure. */
  savingsPaise: Paise;
}

/**
 * A coupon discount decided elsewhere.
 *
 * The pricing engine deliberately does NOT evaluate coupon eligibility — that is
 * the coupon engine's job (TASK 012). Pricing only applies an already-approved
 * amount, which keeps this engine free of coupon rules and makes both testable in
 * isolation.
 */
export interface AppliedDiscount {
  couponId: string | null;
  code: string | null;
  /** Discount against items. */
  amountPaise: number;
  /** True for FREE_DELIVERY coupons, which waive the fee instead. */
  waivesDeliveryFee: boolean;
  /**
   * The lines the discount may be allocated across, by `PricingLineInput.id`.
   *
   * Set by a SCOPED coupon — one restricted to a category, product or vendor.
   * Without it, a "15% off staples" coupon would spread its discount over the milk
   * in the same cart, showing the customer a saving on a line the coupon never
   * covered. The cart total would still be right, so the error would only ever be
   * visible per line, which is exactly the kind of thing that goes unnoticed.
   *
   * Omit or leave null for a whole-cart coupon.
   */
  eligibleLineIds?: readonly string[] | null;
}

export interface PricingInput {
  lines: readonly PricingLineInput[];
  /** Null when no serviceable zone is known yet, so no fee can be quoted. */
  zone: ZoneFeeConfig | null;
  /** Road distance for a per-km zone. Null when unknown. */
  distanceKm?: number | null;
  discount?: AppliedDiscount | null;
  /**
   * Fees with no configuration source in the schema.
   *
   * `orders` has the columns but nothing defines the values, so they default to
   * zero rather than being invented. Passed in explicitly once an admin setting
   * exists.
   */
  packagingFeePaise?: number;
  serviceFeePaise?: number;
  taxStrategy?: TaxStrategy;
}

export interface PricingResult {
  lines: PricedLine[];
  itemCount: number;
  /** Distinct lines, as opposed to total units. */
  lineCount: number;

  grossAmountPaise: Paise;
  itemDiscountPaise: Paise;
  couponDiscountPaise: Paise;
  taxableAmountPaise: Paise;
  /** Always zero while D-14 is blocked. */
  taxAmountPaise: Paise;
  /** Whether a tax line may be rendered. False under NoTaxStrategy. */
  isTaxDisplayable: boolean;

  deliveryFeePaise: Paise;
  /** The fee before any waiver, so the saving can be shown. */
  deliveryFeeBeforeDiscountPaise: Paise;
  isDeliveryFree: boolean;
  /** Why delivery is free, so the UI can say the right thing. */
  deliveryWaivedBy: 'threshold' | 'coupon' | 'zone' | null;

  packagingFeePaise: Paise;
  serviceFeePaise: Paise;
  totalAmountPaise: Paise;

  /** Total saved against MRP plus discounts. */
  totalSavingsPaise: Paise;

  /** Null when there is no threshold, or it is already met. */
  freeDeliveryGapPaise: Paise | null;
  meetsMinimumOrder: boolean;
  minimumOrderGapPaise: Paise | null;
  minOrderPaise: Paise | null;

  /** True when no zone is known, so fees could not be quoted. */
  isQuoteIncomplete: boolean;
}
