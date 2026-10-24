import { requireCurrentActor } from '@/lib/auth/current-actor';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getDeliveryService } from '@/modules/delivery';

/**
 * GET /api/v1/driver/deliveries/available — the offer queue (polled).
 *
 * `cashBlocked` is the field that matters. A driver over the cash limit is excluded from COD work
 * by dispatch (D-18), and without this flag their screen would simply be empty for no visible
 * reason — the single most confusing thing a delivery app can do to someone waiting for work.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const service = await getDeliveryService();
    const result = await service.listOffers({ userId: actor.userId });

    const response = apiSuccess(result, {
      meta: { requestId, locale, total: result.offers.length },
    });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
