import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { orderIdParamSchema } from '@/modules/order';
import { getPaymentService, refundBodySchema } from '@/modules/payment';

/**
 * POST /api/v1/admin/orders/:orderId/refund — staff-initiated refund (docs/API_SPEC.md §7).
 *
 * Gated on `refund:manage`, not merely on being an admin: moving money back out is the most
 * consequential thing the admin surface can do, and the permission exists so it can be granted
 * to finance without granting everything else (docs/SECURITY.md §5.2).
 *
 * `refundMode` in the response is the part that matters operationally. A prepaid order is
 * reversed through the gateway and the customer sees it in days. A COD order never had a gateway
 * payment, so it becomes a MANUAL_PAYOUT that a person has to approve and hand over (D-15) —
 * reporting both as "refunded" would promise a customer money nobody has been asked to send.
 *
 * The amount is REQUIRED. No "refund everything" default, because that is how a partial refund
 * becomes a full one on a mis-click.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentPermission('refund:manage');

    const params = orderIdParamSchema.safeParse(await context.params);
    if (!params.success) throw new ValidationError('That order could not be found.');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A JSON body is required.');
    }

    const parsed = refundBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid refund request.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getPaymentService();

    const { refund, mode } = await service.refundOrder({
      orderId: params.data.orderId,
      amountPaise: parsed.data.amountPaise,
      reason: parsed.data.reason,
      // Recorded on the refund row: who authorised money leaving is the first question asked
      // about any refund afterwards.
      initiatedBy: actor.userId,
    });

    const response = apiSuccess(
      {
        refund: {
          id: refund.id,
          amountPaise: refund.amountPaise,
          status: refund.status,
          refundType: refund.refundType,
          providerRefundId: refund.providerRefundId,
        },
        refundMode: mode,
        /**
         * Said plainly rather than implied by the mode, because the person clicking needs to
         * know whether they have just finished the job or only started it.
         */
        requiresManualPayout: mode === 'MANUAL_PAYOUT',
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
