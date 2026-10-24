import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { requireVendorActor } from '@/lib/http/vendor-scope';
import { getOrderService, orderIdParamSchema, type OrderStatus } from '@/modules/order';

/**
 * The shared body of every vendor order action (accept, reject, preparing, ready).
 *
 * Written once because the four handlers differ only in the target status. Four copies would be
 * four chances for one of them to forget the vendor scope — which is the only thing standing
 * between a vendor and somebody else's orders.
 *
 * The ORDER OF THE TWO AUTHORISATION STEPS matters:
 *   1. resolve the vendor from the SESSION and check the permission against it
 *   2. read the order scoped to that vendor, so a foreign order id is a 404, not a 403
 * A 403 would confirm the order exists (docs/SECURITY.md §5.4).
 */
export async function handleVendorOrderAction(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
  options: {
    to: OrderStatus;
    /** Only rejection needs one, and the state machine already demands it. */
    requiresReason?: boolean;
    /** Runs after a successful transition, inside the same request. */
    afterTransition?: (input: { orderId: string }) => Promise<Record<string, unknown> | void>;
  }
) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const { actor, vendorId } = await requireVendorActor('order:update_status');

    const params = orderIdParamSchema.safeParse(await context.params);
    if (!params.success) throw new ValidationError('That order could not be found.');

    let reason: string | null = null;

    if (options.requiresReason) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new ValidationError('A reason is required.');
      }

      const value = (body as { reason?: unknown } | null)?.reason;
      if (typeof value !== 'string' || value.trim().length < 3) {
        throw new ValidationError('A reason is required.');
      }

      reason = value.trim();
    }

    const service = await getOrderService();

    // Scoped read FIRST: this is what makes another vendor's order indistinguishable from one
    // that does not exist.
    await service.getForVendor(vendorId, params.data.orderId);

    const order = await service.transition({
      orderId: params.data.orderId,
      to: options.to,
      actor: 'VENDOR',
      actorUserId: actor.userId,
      reason,
    });

    const extra = (await options.afterTransition?.({ orderId: order.id })) ?? {};

    const response = apiSuccess(
      { order: { id: order.id, orderNumber: order.orderNumber, status: order.status }, ...extra },
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
