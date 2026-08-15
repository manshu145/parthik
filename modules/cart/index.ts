import { getCatalogService } from '@/modules/catalog';
import { getCouponService } from '@/modules/coupons';
import { getLocationService } from '@/modules/location';
import { CartService } from './cart.service';

/**
 * Cart module composition root.
 *
 * PERSISTENCE NOTE. The approved architecture stores carts in Postgres
 * (`carts`/`cart_items`) and that stays authoritative. Until a database is
 * provisioned (D-01a), the guest cart is persisted in a cookie — see
 * `lib/http/cart-cookie.ts` for why an in-memory cart would be actively worse.
 *
 * The service itself is storage-agnostic on purpose: it takes an intent and returns
 * a new intent, so the same rules serve both backends and the Postgres repository
 * can be dropped in without touching a single rule.
 */

export async function getCartService(): Promise<CartService> {
  const [catalog, location, coupons] = await Promise.all([
    getCatalogService(),
    getLocationService(),
    getCouponService(),
  ]);

  return new CartService({ catalog, location, coupons });
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
