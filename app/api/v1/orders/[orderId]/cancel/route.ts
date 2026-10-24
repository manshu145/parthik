import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { resolveRequestLocale } from '@/lib/http/request-locale';
import { cancelOrderBodySchema, getOrderService, orderIdParamSchema } from '@/modules/order';

/**
 * POST /api/v1/orders/:orderId/cancel — customer cancellation.
 *
 * Two independent gates, and both are enforced server-side:
 *
 *   1. The STATE MACHINE decides whether the move is structurally possible.
 *   2. The CANCELLATION POLICY decides whether the business permits it and what refund is
 *      owed (D-19).
 *
 * An order can be structurally cancellable and commercially not — a customer cancelling
 * after the vendor has started cooking, for instance. Both have to agree.
 *
 * `restrictToUserId` is passed so this endpoint can only ever cancel the CALLER's order.
 * Admin cancellation is a separate, permission-gated path.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const params = orderIdParamSchema.safeParse(await context.params);
    if (!params.success) throw new ValidationError('That order could not be found.');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Please tell us why you are cancelling.');
    }

    const parsed = cancelOrderBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Please tell us why you are cancelling.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getOrderService();

    const { order, decision } = await service.cancel({
      orderId: params.data.orderId,
      actor: 'CUSTOMER',
      actorUserId: actor.userId,
      reason: parsed.data.reason,
      // Scopes the lookup to the caller, so this can never cancel somebody else's order.
      restrictToUserId: actor.userId,
    });

    return apiSuccess(
      {
        order: { id: order.id, orderNumber: order.orderNumber, status: order.status },
        refund: {
          amountPaise: decision.refundAmountPaise,
          percent: decision.refundPercent,
          includesDeliveryFee: decision.refundDeliveryFee,
          /**
           * A COD order has no captured payment to reverse, so there is nothing to refund —
           * stated explicitly rather than reporting an amount that will never move
           * (docs/ARCHITECTURE.md §11.2.1).
           */
          isPayable: !order.isCod && decision.refundAmountPaise > 0,
        },
      },
      { meta: { requestId, locale } }
    );
  } catch (error) {
    return apiError(error, { requestId });
  }
}
