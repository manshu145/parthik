import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { loadCart, persistCart } from '@/lib/shell/cart-session';
import { readCartPincode } from '@/lib/shell/current-cart';
import { getCartService } from '@/modules/cart';
import { addItemSchema } from '@/modules/cart/cart.schema';

/**
 * POST /api/v1/cart/items (docs/API_SPEC.md §5)
 *
 * Adds a variant, or increases an existing line.
 *
 * The request carries `{ variantId, quantity }` and NOTHING ELSE — no price, no
 * name, no total. A client that could send a price could send the wrong one, so the
 * shape makes it impossible rather than relying on the server to ignore it.
 *
 * Rejects an unavailable product outright rather than silently adding it.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A JSON body is required.');
    }

    const parsed = addItemSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        'Invalid cart request.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const [{ intent, owner, userId }, pincode, service] = await Promise.all([
      loadCart(),
      readCartPincode(),
      getCartService(),
    ]);

    const next = await service.addItem(intent, parsed.data.variantId, parsed.data.quantity, {
      locale,
    });

    const view = await service.view(next, { locale, ...(pincode ? { pincode } : {}), userId });

    const response = apiSuccess(
      { cart: view },
      { meta: { requestId, locale, total: view.totals.itemCount } }
    );

    await persistCart(response, owner, next);
    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
