/**
 * View models for marketing UI.
 *
 * WHY THESE EXIST: the ESLint import boundary forbids `components/**` from importing
 * `@/modules/*`, so presentational components cannot reference `OfferSummary`
 * directly. These are the narrow, structural shapes a component actually needs.
 *
 * `OfferSummary` is structurally assignable to `OfferCardView`, so pages pass
 * service results straight through with no mapping boilerplate, while the component
 * stays decoupled from the data layer and testable with a literal.
 */

export interface OfferCardView {
  id: string;
  code: string;
  couponType: 'FLAT' | 'PERCENTAGE' | 'FREE_DELIVERY';
  discountValue: number;
  maxDiscountPaise: number | null;
  minCartPaise: number;
  firstOrderOnly: boolean;
  validUntil: Date | null;
  name: string;
  description: string | null;
}

/** Copy for an offer card. Passed in translated, never looked up in the component. */
export interface OfferCardLabels {
  copy: string;
  copied: string;
  minCart: (amount: string) => string;
  upTo: (amount: string) => string;
  firstOrderOnly: string;
  expires: (date: string) => string;
}

/**
 * The coupon state a cart is carrying, for the cart's coupon control.
 *
 * `reason` is a free string here rather than the `CouponRejectionCode` union: the
 * component only decides whether to show a "no longer applies" note, and importing
 * the union would drag the coupon module across the boundary for no benefit.
 */
export interface CartCouponView {
  code: string;
  isApplied: boolean;
  reason?: string;
  discountPaise: number;
  waivesDeliveryFee: boolean;
}
