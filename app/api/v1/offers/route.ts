import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { readCartPincode } from '@/lib/shell/current-cart';
import { getCouponService } from '@/modules/coupons';
import { getLocationService } from '@/modules/location';

/**
 * GET /api/v1/offers (docs/API_SPEC.md §5)
 *
 * Active, publicly listable coupons for the caller's delivery zone.
 *
 * NOT SHARED-CACHED, even though it is public: the response varies by the customer's
 * chosen zone, which lives in a cookie. A shared cache would serve one zone's offers
 * to another zone's customers, who would then be refused at the cart. Per-zone cache
 * keys are the right fix once zones are stable enough to enumerate.
 *
 * User-specific coupons are never listed — see `listPublicOffers`.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const [pincode, coupons] = await Promise.all([readCartPincode(), getCouponService()]);

    // A customer who has not chosen a location still sees everything unrestricted.
    let zoneId: string | null = null;
    if (pincode) {
      const location = await getLocationService();
      const serviceability = await location.checkServiceability(pincode);
      zoneId = serviceability.zone?.id ?? null;
    }

    const offers = await coupons.listOffers(locale, zoneId);

    const response = apiSuccess({ offers }, { meta: { requestId, locale, total: offers.length } });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
