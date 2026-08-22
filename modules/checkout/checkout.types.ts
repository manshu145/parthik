import type { AddressRecord } from '@/modules/customer';
import type { CartView } from '@/modules/cart';

/**
 * Checkout contracts (docs/API_SPEC.md §6, master spec §12).
 *
 * A quote is a SERVER-COMPUTED, re-verified snapshot of what an order would be. It is
 * never trusted from the client and is always recomputed — including once more inside the
 * order-creation transaction, because zones, stock, prices and store hours all change
 * between someone opening checkout and pressing pay.
 */

/** D-12: the methods offered in V1. NETBANKING/WALLET are reserved, not offered. */
export type PaymentMethod = 'UPI' | 'CARD' | 'COD';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['UPI', 'CARD', 'COD'];

/**
 * Why a payment method cannot be used.
 *
 * Reported per method rather than as one flat error, so the UI can grey out COD with a
 * reason instead of failing the whole quote — the customer can still pay another way.
 */
export type PaymentMethodRejection =
  | { code: 'COD_DISABLED_PLATFORM' }
  | { code: 'COD_DISABLED_ZONE' }
  | { code: 'COD_DISABLED_STORE' }
  | { code: 'COD_ORDER_VALUE_TOO_HIGH'; maxOrderValuePaise: number };

export interface PaymentMethodOption {
  method: PaymentMethod;
  isAvailable: boolean;
  rejection?: PaymentMethodRejection;
}

/**
 * Anything that must be resolved before an order can be placed.
 *
 * Distinct from a cart issue: these are checkout-specific and each names the step the
 * customer has to return to.
 */
export type CheckoutBlocker =
  | { code: 'CART_EMPTY' }
  | { code: 'ADDRESS_REQUIRED' }
  | { code: 'NOT_SERVICEABLE'; pincode: string }
  | { code: 'STORE_NOT_ACCEPTING_ORDERS' }
  | { code: 'MIN_ORDER_NOT_MET'; minOrderPaise: number; shortfallPaise: number }
  | { code: 'INSUFFICIENT_STOCK'; variantId: string; availableQuantity: number }
  | { code: 'PRODUCT_UNAVAILABLE'; variantId: string }
  | { code: 'PAYMENT_METHOD_UNAVAILABLE'; method: PaymentMethod };

export interface CheckoutQuote {
  /** The re-priced cart. Totals here are authoritative for display only. */
  cart: CartView;

  address: AddressRecord | null;
  /** Resolved from the address pincode AT QUOTE TIME, not from the stored zone id. */
  zoneId: string | null;
  isServiceable: boolean;

  deliveryFeePaise: number;
  isFreeDelivery: boolean;
  freeDeliveryGapPaise: number | null;

  etaMinMinutes: number | null;
  etaMaxMinutes: number | null;

  paymentMethods: PaymentMethodOption[];
  selectedMethod: PaymentMethod | null;

  /**
   * What the customer pays. Recomputed from the pricing engine, never summed by the UI.
   *
   * 🔴 Carries NO TAX LINE. D-14 is blocked, so no tax treatment is asserted — not even a
   * zero one, because displaying "₹0 GST" is itself a claim about tax
   * (docs/ARCHITECTURE.md §11.2.2).
   */
  totalPaise: number;

  /** COD amount to collect at the door, when COD is the selected method. */
  codAmountPaise: number | null;

  blockers: CheckoutBlocker[];
  /** True only when an order could be created from this quote right now. */
  canPlaceOrder: boolean;
}
