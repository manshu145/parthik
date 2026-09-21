import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { deliverBodySchema, deliveryIdParamSchema, getDeliveryService } from '@/modules/delivery';

/**
 * POST /api/v1/driver/deliveries/:id/deliver — the handover (D-20, docs/API_SPEC.md §8).
 *
 * THE MOST CONSEQUENTIAL REQUEST IN THE APP. One call verifies the OTP, completes the delivery,
 * moves the order to DELIVERED, converts the stock reservation into a sale, marks the COD payment
 * paid and adds the cash to the driver's float — all in one transaction, because a partial version
 * of that is either stock that was never sold or cash nobody is accountable for.
 *
 * The OTP is MANDATORY. A driver cannot mark an order delivered without a code the customer read
 * out, which is the entire defence against deliveries confirmed from a car park (threat T14).
 *
 * A COD MISMATCH IS A WARNING, NOT AN ERROR. The delivery completes and the variance is recorded:
 * refusing over a ten-rupee shortfall would strand the customer and the driver arguing on a
 * doorstep, while silently accepting it would make reconciliation fiction.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ deliveryId: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    // Ownership, not permission: the DRIVER role holds none by design.
    const actor = await requireCurrentActor();

    const params = deliveryIdParamSchema.safeParse(await context.params);
    if (!params.success) throw new ValidationError('That delivery could not be found.');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Enter the 6-digit delivery code.');
    }

    const parsed = deliverBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Enter the 6-digit delivery code.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getDeliveryService();

    const result = await service.deliver({
      userId: actor.userId,
      deliveryId: params.data.deliveryId,
      otp: parsed.data.otp,
      codCollectedPaise: parsed.data.codCollectedPaise ?? null,
      recipientName: parsed.data.recipientName ?? null,
      proofKey: parsed.data.proofKey ?? null,
    });

    const response = apiSuccess(
      {
        delivered: true,
        codCollectedPaise: result.codCollectedPaise,
        codVariancePaise: result.codVariancePaise,
        /**
         * Reported in the SUCCESS body, deliberately.
         *
         * The delivery is complete; the mismatch is something the driver and the office have to
         * settle afterwards. Returning it as an error would suggest nothing happened.
         */
        warning: result.warning,
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
