import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { declineBodySchema, deliveryIdParamSchema, getDeliveryService } from '@/modules/delivery';

/**
 * POST /api/v1/driver/deliveries/:id/decline — pass on an offer.
 *
 * Recorded rather than ignored, because a decline is dispatch data: it stops the same job being
 * re-offered to the same driver, and a driver who declines everything is a pattern worth seeing.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ deliveryId: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const params = deliveryIdParamSchema.safeParse(await context.params);
    if (!params.success) throw new ValidationError('That delivery could not be found.');

    const raw = await request.text();
    const parsed = declineBodySchema.safeParse(raw ? JSON.parse(raw) : {});
    if (!parsed.success) throw new ValidationError('Invalid request.');

    const service = await getDeliveryService();
    await service.declineOffer({
      userId: actor.userId,
      deliveryId: params.data.deliveryId,
      reason: parsed.data.reason ?? null,
    });

    const response = apiSuccess({ declined: true }, { meta: { requestId, locale } });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
