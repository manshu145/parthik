import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getDeliveryService, locationPingBodySchema } from '@/modules/delivery';

/**
 * POST /api/v1/driver/location — a position ping (D-29, C-1).
 *
 * OVERWRITES one row; it never appends. The dispatch position is "where is this driver now", and
 * storing every ping would build a movement history nobody consented to — so the only trail that
 * exists is the one attached to an active delivery, and that is purged after seven days.
 *
 * An offline driver's ping is REFUSED rather than quietly stored.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A JSON body is required.');
    }

    const parsed = locationPingBodySchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid coordinates.');

    const service = await getDeliveryService();
    await service.updateLocation({
      userId: actor.userId,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
    });

    const response = apiSuccess({ recorded: true }, { meta: { requestId, locale } });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
