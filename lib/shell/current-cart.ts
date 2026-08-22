import { cookies } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import type { Locale } from '@/i18n/routing';
import { parseCartCookie, CART_COOKIE_NAME } from '@/lib/http/cart-cookie';
import { parseZoneCookie, ZONE_COOKIE_NAME } from '@/lib/http/zone-cookie';
import { logger } from '@/lib/logger';
import { loadCart } from './cart-session';
import { getCartService } from '@/modules/cart';
import type { CartIntent, CartView } from '@/modules/cart';

/**
 * Reads the current cart on the server.
 *
 * Used by layouts and pages so the header badge and drawer are correct on FIRST
 * PAINT. Reading client-side instead would flash an empty cart on every navigation,
 * which reads as though the cart was lost.
 *
 * The cookie holds intent only; every price here is re-read from the database.
 */

export async function readCartIntent(): Promise<CartIntent> {
  const store = await cookies();
  const payload = parseCartCookie(store.get(CART_COOKIE_NAME)?.value);

  return {
    storeId: payload.storeId,
    lines: payload.lines,
    couponCode: payload.couponCode,
  };
}

/** The pincode of the chosen delivery location, if any. */
export async function readCartPincode(): Promise<string | null> {
  const store = await cookies();
  const zone = parseZoneCookie(store.get(ZONE_COOKIE_NAME)?.value);

  return zone?.isServiceable ? zone.pincode : null;
}

/**
 * Full, priced cart view for server rendering.
 *
 * Returns null on failure rather than throwing: a cart read must never be the
 * reason a catalogue page fails to render.
 *
 * ⚠️ `unstable_rethrow` IS LOAD-BEARING. Next.js signals dynamic rendering, `notFound`
 * and redirects by THROWING, and this function reads cookies — so a blanket catch
 * swallowed the "this route must be dynamic" signal. The visible symptom was a
 * `Dynamic server usage` error logged during build while the page silently rendered
 * as an empty cart. Framework control-flow errors must be re-thrown before any of
 * our own error handling runs.
 */
export async function getCartView(locale: Locale): Promise<CartView | null> {
  try {
    // Goes through the session resolver, so a signed-in customer's server-rendered
    // header and drawer read the SAME cart the API mutates. Reading the cookie here
    // while the API wrote to Postgres would show two different carts on one page.
    const [{ intent, userId }, pincode, service] = await Promise.all([
      loadCart(),
      readCartPincode(),
      getCartService(),
    ]);

    return service.view(intent, { locale, ...(pincode ? { pincode } : {}), userId });
  } catch (error) {
    unstable_rethrow(error);
    logger.exception(error);
    return null;
  }
}
