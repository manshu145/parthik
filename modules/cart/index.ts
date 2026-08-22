import { getCatalogService } from '@/modules/catalog';
import { getCouponService } from '@/modules/coupons';
import { getLocationService } from '@/modules/location';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { CartService } from './cart.service';
import { DrizzleCartStore } from './cart.repository';
import type { CartStore } from './cart.repository.types';

/**
 * Cart module composition root.
 *
 * PERSISTENCE, IN TWO PLACES AND FOR TWO REASONS:
 *
 *   SIGNED IN  → Postgres `carts`/`cart_items`, so the cart follows the customer
 *                between devices and survives a cookie being cleared.
 *   GUEST      → the cookie (`lib/http/cart-cookie.ts`). Deliberate, not a shortcut:
 *                a row per anonymous visitor accumulates garbage nothing collects, and
 *                the cookie already survives a reload with no database round trip on
 *                every catalogue page.
 *
 * The service is storage-agnostic — intent in, intent out — so the rules (D-11 one
 * store per cart, stock validation, quantity limits) are identical on both sides and
 * exist in exactly one place.
 */

export async function getCartService(): Promise<CartService> {
  const [catalog, location, coupons] = await Promise.all([
    getCatalogService(),
    getLocationService(),
    getCouponService(),
  ]);

  return new CartService({ catalog, location, coupons });
}

/**
 * The persistent cart store, or null when no database is configured.
 *
 * Null rather than throwing: without a database a signed-in customer falls back to the
 * cookie cart, which is a degraded but working experience. Refusing to render the cart
 * at all would be worse, and this path only occurs in local development.
 */
export async function getCartStore(): Promise<CartStore | null> {
  if (!isDatabaseConfigured()) return null;

  const db = await getDb();
  return new DrizzleCartStore({ db });
}

export { CartService, createCartService } from './cart.service';
export type { CartContext, CartServiceDeps } from './cart.service';
export { MAX_QUANTITY_PER_LINE } from './cart.types';
export type {
  CartCouponState,
  CartIntent,
  CartIntentLine,
  CartIssue,
  CartLine,
  CartLineIssue,
  CartView,
} from './cart.types';
export { addItemSchema, setQuantitySchema, variantIdParamSchema } from './cart.schema';
export { DrizzleCartStore, createCartStore } from './cart.repository';
export type { CartStore } from './cart.repository.types';
