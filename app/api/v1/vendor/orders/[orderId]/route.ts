import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { requireVendorActor } from '@/lib/http/vendor-scope';
import { getOrderService, orderIdParamSchema } from '@/modules/order';

/**
 * GET /api/v1/vendor/orders/:orderId — one order, for the vendor.
 *
 * CUSTOMER DATA IS LIMITED TO OPERATIONAL NECESSITY (master spec §14). The vendor gets the items,
 * the totals, the timeline and a first name — NOT the delivery address and NOT the phone number.
 * A vendor never delivers, so they never need either, and handing over a full address on every
 * order would be a standing privacy leak with no operational benefit.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const { vendorId } = await requireVendorActor('order:view');

    const params = orderIdParamSchema.safeParse(await context.params);
    if (!params.success) throw new ValidationError('That order could not be found.');

    const service = await getOrderService();
    const detail = await service.getForVendor(vendorId, params.data.orderId);

    const response = apiSuccess(
      {
        order: {
          id: detail.order.id,
          orderNumber: detail.order.orderNumber,
          status: detail.order.status,
          paymentMethod: detail.order.paymentMethod,
          paymentStatus: detail.order.paymentStatus,
          isCod: detail.order.isCod,
          totalAmountPaise: detail.order.totalAmountPaise,
          placedAt: detail.order.placedAt,
          customerNote: detail.order.customerNote,
          // First name only. Enough to greet a customer at a counter, not enough to identify them.
          customerFirstName: detail.order.contactName.split(' ')[0] ?? '',
        },
        lines: detail.lines,
        timeline: detail.timeline,
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
