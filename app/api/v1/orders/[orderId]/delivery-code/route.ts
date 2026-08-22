import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getDeliveryService } from '@/modules/delivery';
import { orderIdParamSchema } from '@/modules/order';

/**
 * POST /api/v1/orders/:orderId/delivery-code — reveal the delivery code to the CUSTOMER (D-20).
 *
 * A POST, not a GET, because it CREATES a code. Only the hash is ever stored, so there is nothing
 * to read back — which is the point: a database dump, a log line or a support screenshot can never
 * expose a live code. The trade is that revealing it means issuing a fresh one.
 *
 * Owner-scoped, and bounded: each reveal invalidates the code the driver may already be holding, so
 * an unlimited button would be a way to make a delivery unconfirmable.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const params = orderIdParamSchema.safeParse(await context.params);
    if (!params.success) throw new ValidationError('That order could not be found.');

    const service = await getDeliveryService();
    const result = await service.regenerateOtpForCustomer({
      orderId: params.data.orderId,
      userId: actor.userId,
    });

    const response = apiSuccess(
      {
        otp: result.otp,
        // Said explicitly so the UI can warn before the customer taps it again.
        note: 'Share this code with the delivery partner. Asking for a new code replaces this one.',
      },
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
