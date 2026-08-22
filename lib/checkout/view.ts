/**
 * View models for the checkout UI.
 *
 * WHY THESE EXIST: the ESLint import boundary forbids `components/**` from importing
 * `@/modules/*`, so a presentational component cannot reference `CheckoutQuote` directly.
 * These are the narrow, STRUCTURAL shapes the component actually needs.
 *
 * `CheckoutQuote` is structurally assignable to `CheckoutQuoteView`, so pages pass service
 * results straight through with no mapping boilerplate, while the component stays
 * decoupled from the data layer and testable with a literal.
 *
 * Same pattern as `lib/marketing/view.ts` and `lib/shell/types.ts`.
 */

export type PaymentMethodView = 'UPI' | 'CARD' | 'COD';

export type PaymentMethodRejectionView =
  | { code: 'COD_DISABLED_PLATFORM' }
  | { code: 'COD_DISABLED_ZONE' }
  | { code: 'COD_DISABLED_STORE' }
  | { code: 'COD_ORDER_VALUE_TOO_HIGH'; maxOrderValuePaise: number };

export interface PaymentMethodOptionView {
  method: PaymentMethodView;
  isAvailable: boolean;
  rejection?: PaymentMethodRejectionView | undefined;
}

export type CheckoutBlockerView =
  | { code: 'CART_EMPTY' }
  | { code: 'ADDRESS_REQUIRED' }
  | { code: 'NOT_SERVICEABLE'; pincode: string }
  | { code: 'STORE_NOT_ACCEPTING_ORDERS' }
  | { code: 'MIN_ORDER_NOT_MET'; minOrderPaise: number; shortfallPaise: number }
  | { code: 'INSUFFICIENT_STOCK'; variantId: string; availableQuantity: number }
  | { code: 'PRODUCT_UNAVAILABLE'; variantId: string }
  | { code: 'PAYMENT_METHOD_UNAVAILABLE'; method: PaymentMethodView };

/** An address as the picker renders it, with serviceability already resolved. */
export interface CheckoutAddressView {
  id: string;
  label: string | null;
  recipientName: string;
  recipientPhone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  pincode: string;
  isDefault: boolean;
  isServiceable: boolean;
}

/**
 * The totals the summary renders.
 *
 * Deliberately has NO tax field. D-14 is blocked, so the view model cannot even express a
 * tax line — which makes "we accidentally rendered ₹0 GST" impossible rather than merely
 * discouraged (docs/ARCHITECTURE.md §11.2.2).
 */
export interface CheckoutTotalsView {
  itemCount: number;
  grossAmountPaise: number;
  itemDiscountPaise: number;
  couponDiscountPaise: number;
}

export interface CheckoutQuoteView {
  cart: {
    totals: CheckoutTotalsView;
    coupon: { code: string; isApplied: boolean } | null;
  };
  address: { id: string } | null;
  deliveryFeePaise: number;
  isFreeDelivery: boolean;
  etaMinMinutes: number | null;
  etaMaxMinutes: number | null;
  paymentMethods: PaymentMethodOptionView[];
  selectedMethod: PaymentMethodView | null;
  totalPaise: number;
  codAmountPaise: number | null;
  blockers: CheckoutBlockerView[];
  canPlaceOrder: boolean;
}
