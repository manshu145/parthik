import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import {
  deliveryIdParamSchema,
  deliveryStepBodySchema,
  getDeliveryService,
} from '@/modules/delivery';
import type { DeliveryService } from '@/modules/delivery';

/**
 * The shared body of every driver progress step (reached store, pickup, en route, reached
 * customer).
 *
 * THERE IS NO PERMISSION CHECK HERE, and that is correct rather than an omission: the DRIVER role
 * holds no permissions at all (`modules/identity/permissions.ts`). A driver acts only on their own
 * work, so authorisation is an OWNERSHIP check — the service resolves the caller's driver record
 * and the repository requires `deliveries.driver_id` to match. A permission would let any driver
 * touch any delivery.
 *
 * Position is optional on every step. A driver who has denied location permission can still do
 * their job, and refusing the step would make the app unusable for them.
 */
export async function handleDriverStep(
  request: Request,
  context: { params: Promise<{ deliveryId: string }> },
  step: (
    service: DeliveryService,
    input: {
      userId: string;
      deliveryId: string;
      position?: { latitude: number; longitude: number };
    }
  ) => Promise<unknown>
) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const params = deliveryIdParamSchema.safeParse(await context.params);
    if (!params.success) throw new ValidationError('That delivery could not be found.');

    // A body is optional: `fetch` with no body is the common case from a phone.
    const raw = await request.text();
    const parsed = deliveryStepBodySchema.safeParse(raw ? JSON.parse(raw) : {});
    if (!parsed.success) throw new ValidationError('Invalid request.');

    const service = await getDeliveryService();

    const result = await step(service, {
      userId: actor.userId,
      deliveryId: params.data.deliveryId,
      ...(parsed.data?.position ? { position: parsed.data.position } : {}),
    });

    const response = apiSuccess(result, { meta: { requestId, locale } });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
