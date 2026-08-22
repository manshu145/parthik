import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { availabilityBodySchema, getDeliveryService } from '@/modules/delivery';

/**
 * PATCH /api/v1/driver/availability — go online, take a break, or stop for the day.
 *
 * Refused WITH A REASON when the driver is not approved (docs/API_SPEC.md §8). Accepting it and
 * then never sending offers is the version of this that generates support tickets.
 *
 * Going OFFLINE deletes the stored position (D-29, C-1): location is collected to dispatch work,
 * so it is kept only while there is work to dispatch.
 */

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
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

    const parsed = availabilityBodySchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Choose a valid availability.');

    const service = await getDeliveryService();
    const driver = await service.setAvailability({
      userId: actor.userId,
      availability: parsed.data.availability,
    });

    const response = apiSuccess(
      { availability: driver.availability, status: driver.status },
      { meta: { requestId, locale } }
    );

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
