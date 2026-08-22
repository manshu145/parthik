import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { clearCart, loadCart } from '@/lib/shell/cart-session';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { readCartPincode } from '@/lib/shell/current-cart';
import { getCartService } from '@/modules/cart';

/**
 * GET /api/v1/cart — the cart with SERVER-RECOMPUTED totals (docs/API_SPEC.md §5).
 * DELETE /api/v1/cart — clear.
 *
 * Never cached. A cart is per-customer and its prices and stock are re-read on
 * every request; a cached cart is how someone sees a total that no longer applies.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const [{ intent, userId }, pincode, service] = await Promise.all([
      loadCart(),
      readCartPincode(),
      getCartService(),
    ]);

    const view = await service.view(intent, {
      locale,
      ...(pincode ? { pincode } : {}),
      // Passed so user-scoped coupon rules (first-order, per-user limit) can be
      // evaluated. Omitting it silently refused those coupons for signed-in customers.
      userId,
    });

    const response = apiSuccess(
      { cart: view },
      { meta: { requestId, locale, total: view.totals.itemCount } }
    );

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const { owner } = await loadCart();
    const response = apiSuccess({ cleared: true }, { meta: { requestId, locale } });

    await clearCart(response, owner);

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
