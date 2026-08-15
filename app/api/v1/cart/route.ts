import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { clearCartCookie } from '@/lib/http/cart-cookie';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { readCartIntent, readCartPincode } from '@/lib/shell/current-cart';
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
    const [intent, pincode, service] = await Promise.all([
      readCartIntent(),
      readCartPincode(),
      getCartService(),
    ]);

    const view = await service.view(intent, { locale, ...(pincode ? { pincode } : {}) });

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

export function DELETE(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  const response = apiSuccess({ cleared: true }, { meta: { requestId, locale } });
  clearCartCookie(response);

  return response;
}
