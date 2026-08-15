import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { setCartCookie } from '@/lib/http/cart-cookie';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { readCartIntent, readCartPincode } from '@/lib/shell/current-cart';
import { getCartService } from '@/modules/cart';
import { applyCouponSchema } from '@/modules/coupons';

/**
 * POST   /api/v1/cart/coupon — apply (docs/API_SPEC.md §5)
 * DELETE /api/v1/cart/coupon — remove
 *
 * The request carries a CODE and nothing else. There is deliberately no way to send
 * a discount amount: the coupon engine decides what a code is worth from database
 * rows, so a client cannot propose its own discount.
 *
 * A rejected coupon returns the specific documented code — `COUPON_MIN_CART_NOT_MET`
 * with the shortfall, `COUPON_FIRST_ORDER_ONLY`, and so on — because the customer
 * needs to know what to change, and it is NOT persisted: a cart carrying a code that
 * cannot work would show a refusal on every page load.
 *
 * AUTHENTICATION: API_SPEC marks this CUSTOMER. Sessions arrive with TASK 003, so
 * `userId` is null for now, which the coupon engine treats as "cannot satisfy
 * user-scoped rules" rather than "satisfies them".
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

    const parsed = applyCouponSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        'Invalid coupon request.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const [intent, pincode, service] = await Promise.all([
      readCartIntent(),
      readCartPincode(),
      getCartService(),
    ]);

    const context = { locale, ...(pincode ? { pincode } : {}) };

    // Throws the documented coupon error when it does not apply.
    const next = await service.applyCoupon(intent, parsed.data.code, context);
    const view = await service.view(next, context);

    const response = apiSuccess(
      { cart: view },
      { meta: { requestId, locale, total: view.totals.itemCount } }
    );

    setCartCookie(response, next);
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
    const [intent, pincode, service] = await Promise.all([
      readCartIntent(),
      readCartPincode(),
      getCartService(),
    ]);

    // Idempotent: removing a coupon from a cart that has none is a success, not a
    // 404. The customer's intent — "no coupon" — is already satisfied.
    const next = service.removeCoupon(intent);
    const view = await service.view(next, { locale, ...(pincode ? { pincode } : {}) });

    const response = apiSuccess(
      { cart: view },
      { meta: { requestId, locale, total: view.totals.itemCount } }
    );

    setCartCookie(response, next);
    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
