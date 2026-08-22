import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getPaymentService, paymentIntentBodySchema } from '@/modules/payment';

/**
 * POST /api/v1/payments/intent — create or re-create a payment intent (docs/API_SPEC.md §6).
 *
 * The RECOVERY path. A customer whose UPI app timed out, or whose card was declined, comes back
 * to the same order and gets a fresh attempt instead of a dead end and a support ticket.
 *
 * The body carries ONLY an order id. The amount comes from the order row, so there is nothing a
 * modified client could send that would change what it costs. Ownership is enforced in the
 * service, and an order that is already paid is refused rather than given a second payable link.
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

    const parsed = paymentIntentBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid payment request.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getPaymentService();
    const result = await service.createIntent({
      userId: actor.userId,
      orderId: parsed.data.orderId,
    });

    const response = apiSuccess(
      {
        payment: {
          id: result.payment.id,
          status: result.payment.status,
          amountPaise: result.payment.amountPaise,
          currency: result.payment.currency,
        },
        /**
         * Everything the browser needs to open the gateway, and nothing more.
         *
         * The key id here is the PUBLIC one; the secret never leaves the server. Handing it over
         * per-request rather than baking it into the bundle means a rotated key takes effect on
         * the next intent instead of the next deploy.
         */
        clientPayload: result.clientPayload,
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
