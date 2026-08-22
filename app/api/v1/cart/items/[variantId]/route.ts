import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { loadCart, persistCart } from '@/lib/shell/cart-session';
import { readCartPincode } from '@/lib/shell/current-cart';
import { getCartService } from '@/modules/cart';
import { setQuantitySchema, variantIdParamSchema } from '@/modules/cart/cart.schema';

/**
 * PATCH  /api/v1/cart/items/[variantId] — set an exact quantity (0 removes).
 * DELETE /api/v1/cart/items/[variantId] — remove the line.
 *
 * KEYED BY VARIANT, not by a cart-item id. docs/API_SPEC.md §5 writes `[itemId]`,
 * but `cart_items` is unique on `(cart_id, variant_id)` — the variant *is* the line
 * identity. Using it means the client needs no server-assigned id, which is what
 * lets the same endpoints serve the cookie cart and the Postgres cart unchanged.
 */

export const dynamic = 'force-dynamic';

async function respond(
  request: Request,
  variantId: string,
  mutate: 'set' | 'remove',
  quantity?: number
) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  const [{ intent, owner, userId }, pincode, service] = await Promise.all([
    loadCart(),
    readCartPincode(),
    getCartService(),
  ]);

  const next =
    mutate === 'remove'
      ? service.removeItem(intent, variantId)
      : await service.setQuantity(intent, variantId, quantity ?? 0, { locale, userId });

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
}

export async function PATCH(request: Request, context: { params: Promise<{ variantId: string }> }) {
  const requestId = requestIdFrom(request);

  try {
    const params = variantIdParamSchema.safeParse(await context.params);
    if (!params.success) {
      throw new ValidationError(
        'Invalid cart item.',
        params.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A JSON body is required.');
    }

    const parsed = setQuantitySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid quantity.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    return await respond(request, params.data.variantId, 'set', parsed.data.quantity);
  } catch (error) {
    return apiError(error, { requestId });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ variantId: string }> }
) {
  const requestId = requestIdFrom(request);

  try {
    const params = variantIdParamSchema.safeParse(await context.params);
    if (!params.success) {
      throw new ValidationError(
        'Invalid cart item.',
        params.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    return await respond(request, params.data.variantId, 'remove');
  } catch (error) {
    return apiError(error, { requestId });
  }
}
