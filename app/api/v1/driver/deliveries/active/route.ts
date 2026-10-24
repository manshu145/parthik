import { requireCurrentActor } from '@/lib/auth/current-actor';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getDeliveryService } from '@/modules/delivery';

/**
 * GET /api/v1/driver/deliveries/active — the job in hand.
 *
 * Carries the customer's phone number, which every other driver-facing response withholds. That is
 * the rule from master spec §14: revealed only for an ACTIVE assignment, because a driver standing
 * outside a building with no answer needs to call, and a driver browsing offers does not.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const service = await getDeliveryService();
    const active = await service.activeForDriver(actor.userId);

    const response = apiSuccess(
      active
        ? {
            delivery: {
              id: active.delivery.id,
              status: active.delivery.status,
              pickup: active.delivery.pickupAddressSnapshot,
              drop: active.delivery.dropAddressSnapshot,
              codExpectedPaise: active.delivery.codExpectedPaise,
              deliveryFeePaise: active.delivery.deliveryFeePaise,
              otpAttempts: active.delivery.otpAttempts,
            },
            order: {
              orderNumber: active.order.orderNumber,
              isCod: active.order.isCod,
              totalAmountPaise: active.order.totalAmountPaise,
              contactName: active.order.contactName,
              contactPhone: active.order.contactPhone,
            },
          }
        : { delivery: null, order: null },
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
