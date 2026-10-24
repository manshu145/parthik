import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getOrderService, orderIdParamSchema } from '@/modules/order';

/**
 * GET /api/v1/orders/:orderId — one order with its lines and timeline.
 *
 * Also the polling endpoint the tracker uses (D-22): the response carries `isActive` so the
 * client can widen its interval once the order settles, rather than polling a delivered
 * order every few seconds forever.
 *
 * Scoped to the owner in the repository's WHERE clause, so another customer's order id is
 * indistinguishable from one that does not exist.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const parsed = orderIdParamSchema.safeParse(await context.params);
    if (!parsed.success) throw new ValidationError('That order could not be found.');

    const service = await getOrderService();
    const detail = await service.getForUser(actor.userId, parsed.data.orderId);

    const response = apiSuccess(
      {
        order: detail.order,
        lines: detail.lines,
        timeline: detail.timeline,
        // Drives the adaptive polling interval, so the client does not have to keep its own
        // copy of which statuses count as in-flight.
        isActive: service.isActive(detail.order.status),
        canCancel: service.canCustomerCancel(detail.order),
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
