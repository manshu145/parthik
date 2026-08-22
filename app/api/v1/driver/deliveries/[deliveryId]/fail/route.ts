import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { deliveryIdParamSchema, failBodySchema, getDeliveryService } from '@/modules/delivery';

/**
 * POST /api/v1/driver/deliveries/:id/fail — the delivery could not be completed.
 *
 * Moves the order to FAILED_DELIVERY, NOT to CANCELLED, and the difference is physical: the goods
 * are in a driver's bag, not back on a shelf. So the stock stays reserved and the payment stays as
 * it is until an admin decides between a retry, a return and a refund.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ deliveryId: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const params = deliveryIdParamSchema.safeParse(await context.params);
    if (!params.success) throw new ValidationError('That delivery could not be found.');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A reason is required.');
    }

    const parsed = failBodySchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('A reason is required.');

    const service = await getDeliveryService();
    await service.fail({
      userId: actor.userId,
      deliveryId: params.data.deliveryId,
      reason: parsed.data.reason,
    });

    const response = apiSuccess({ failed: true }, { meta: { requestId, locale } });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
