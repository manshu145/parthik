import type { CartIntent } from './cart.types';

/**
 * Cart persistence contract.
 *
 * The cart SERVICE is deliberately storage-agnostic — it takes an intent and returns
 * a new intent — so this port only has to load, save and clear. All the rules
 * (D-11 one store per cart, stock validation, quantity limits) live in the service and
 * are identical whichever side persists.
 *
 * ONLY SIGNED-IN CARTS LIVE HERE. Guest carts stay in the cookie
 * (`lib/http/cart-cookie.ts`), which is a deliberate choice rather than a shortcut:
 * a guest row per anonymous visitor would accumulate garbage that nothing ever
 * collects, and the cookie already survives a reload without a database round trip on
 * every catalogue page.
 */
export interface CartStore {
  /**
   * Loads the user's cart, or an empty intent when they have none.
   *
   * Returns an empty intent rather than null so callers cannot forget the
   * no-cart-yet case — every one of them would otherwise need the same guard.
   */
  load(userId: string): Promise<CartIntent>;

  /**
   * Persists the intent, replacing whatever was there.
   *
   * Must be atomic: a cart that is briefly missing lines would be read by a
   * concurrent request as a partial cart, and the customer would see items vanish.
   */
  save(userId: string, intent: CartIntent): Promise<void>;

  /** Removes the cart entirely. Used by "clear cart" and after an order is placed. */
  clear(userId: string): Promise<void>;
}
