import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { deliveryIdParamSchema, getDeliveryService } from '@/modules/delivery';

/**
 * POST /api/v1/driver/deliveries/:id/accept — take the job. FIRST ACCEPT WINS.
 *
 * The race is settled by a conditional UPDATE in the repository, not by reading and then writing:
 * two drivers tapping at the same moment would both pass a read-then-check and both be told the
 * job was theirs, and both would turn up at the store.
 *
 * A COD job is refused when the driver is already holding more than the configured float
 * (D-18) — with a reason, so the app can say "deposit your cash" rather than showing an
 * unexplained failure.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ deliveryId: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const params = deliveryIdParamSchema.safeParse(await context.params);
    if (!params.success) throw new ValidationError('That delivery could not be found.');

    const service = await getDeliveryService();
    const assigned = await service.acceptOffer({
      userId: actor.userId,
      deliveryId: params.data.deliveryId,
    });

    const response = apiSuccess(
      {
        delivery: {
          id: assigned.delivery.id,
          status: assigned.delivery.status,
          pickup: assigned.delivery.pickupAddressSnapshot,
          drop: assigned.delivery.dropAddressSnapshot,
          codExpectedPaise: assigned.delivery.codExpectedPaise,
          deliveryFeePaise: assigned.delivery.deliveryFeePaise,
        },
        order: {
          orderNumber: assigned.order.orderNumber,
          isCod: assigned.order.isCod,
          contactName: assigned.order.contactName,
          /**
           * The customer's number is revealed ONLY for an active assignment (master spec §14).
           * Now that this driver owns the delivery, they need to be able to ring the doorbell that
           * does not work.
           */
          contactPhone: assigned.order.contactPhone,
        },
      },
      { status: 201, meta: { requestId, locale } }
    );

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
