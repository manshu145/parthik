import type { PricingResult } from '@/modules/pricing';

/**
 * Cart contracts.
 *
 * The cart stores INTENT — which variant, how many. Everything monetary is derived
 * on read by the pricing engine from database values, so a cart can never carry a
 * stale or tampered price into checkout.
 */

/** What a customer asked for. The only thing persisted. */
export interface CartIntentLine {
  variantId: string;
  quantity: number;
}

export interface CartIntent {
  /** D-11: one store per cart. Null while the cart is empty. */
  storeId: string | null;
  lines: CartIntentLine[];
  couponCode: string | null;
}

/**
 * Why a line cannot be fulfilled as requested.
 *
 * Warnings do NOT empty the cart. A customer returning to a cart where one item
 * went out of stock should see that item flagged, not silently removed — removal
 * looks like a bug and loses the rest of their intent.
 */
export type CartLineIssue =
  | { code: 'PRODUCT_UNAVAILABLE' }
  | { code: 'INSUFFICIENT_STOCK'; availableQuantity: number }
  | { code: 'PRICE_CHANGED'; previousUnitPricePaise: number; currentUnitPricePaise: number }
  | { code: 'QUANTITY_LIMIT_EXCEEDED'; maxQuantity: number };

export interface CartLine {
  /** Stable per variant, so the UI can key rows and target mutations. */
  id: string;
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantLabel: string | null;
  unitLabel: string | null;
  imageKey: string | null;
  quantity: number;
  /** Re-read from the database, never from the client or the cookie. */
  unitPricePaise: number;
  mrpPaise: number;
  lineTotalPaise: number;
  couponDiscountPaise: number;
  savingsPaise: number;
  inStock: boolean;
  quantityAvailable: number | null;
  issues: CartLineIssue[];
}

/** Blocking problems for the cart as a whole, not one line. */
export type CartIssue =
  | { code: 'CART_EMPTY' }
  | { code: 'MIN_ORDER_NOT_MET'; minOrderPaise: number; shortfallPaise: number }
  | { code: 'STORE_NOT_ACCEPTING_ORDERS' }
  | { code: 'LOCATION_REQUIRED' }
  | { code: 'NOT_SERVICEABLE'; pincode: string };

export interface CartView {
  lines: CartLine[];
  /** Server-computed. The client never derives a total. */
  totals: PricingResult;
  /** Store the cart is locked to, for display and D-11 enforcement. */
  storeId: string | null;
  storeName: string | null;
  appliedCouponCode: string | null;
  /** Must be empty before checkout may proceed. */
  issues: CartIssue[];
  /** Convenience roll-up: any line has a blocking issue. */
  hasLineIssues: boolean;
  /** Delivery estimate for the chosen zone, when one is known. */
  etaMinMinutes: number | null;
  etaMaxMinutes: number | null;
}

/**
 * Maximum units of one variant in a single cart line.
 *
 * ⚠️ NOT AN APPROVED BUSINESS RULE. The schema enforces only `quantity > 0` and the
 * API contract defines a `QUANTITY_LIMIT_EXCEEDED` code, but no numeric limit
 * exists anywhere in the specs. This is a deliberately conservative GUARDRAIL so
 * the documented error code is reachable and a typo cannot order 9,999 units of
 * atta.
 *
 * It belongs in `admin_settings` once a real per-product limit is decided. Flagged
 * rather than quietly invented.
 */
export const MAX_QUANTITY_PER_LINE = 20;
