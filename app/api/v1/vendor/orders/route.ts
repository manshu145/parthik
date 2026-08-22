import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { requireVendorActor } from '@/lib/http/vendor-scope';
import { getOrderService, type OrderStatus } from '@/modules/order';

/**
 * GET /api/v1/vendor/orders — the vendor's queue (docs/API_SPEC.md §7).
 *
 * Scoped to the authenticated vendor, resolved from the session's role grants. There is no
 * `vendorId` parameter, deliberately: an endpoint that accepted one would let any vendor read any
 * other vendor's orders by changing a number.
 */

export const dynamic = 'force-dynamic';

/** The tabs the vendor screen offers (docs/ROUTES.md §6). */
const TABS: Record<string, readonly OrderStatus[]> = {
  new: ['CONFIRMED'],
  accepted: ['ACCEPTED'],
  preparing: ['PREPARING'],
  ready: ['READY_FOR_PICKUP', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'],
  completed: ['DELIVERED'],
  cancelled: ['CANCELLED', 'FAILED_DELIVERY', 'RETURNED', 'REFUNDED'],
};

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const { vendorId } = await requireVendorActor('order:list');

    const url = new URL(request.url);
    const tab = url.searchParams.get('tab');
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const limitRaw = Number(url.searchParams.get('limit') ?? 20);

    if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 50) {
      throw new ValidationError('Invalid page size.');
    }

    if (tab && !(tab in TABS)) throw new ValidationError('Unknown tab.');

    const service = await getOrderService();
    const page = await service.listForVendor(vendorId, {
      limit: limitRaw,
      ...(cursor ? { cursor } : {}),
      ...(tab ? { statuses: TABS[tab] } : {}),
    });

    const response = apiSuccess(page, {
      meta: { requestId, locale, hasMore: page.nextCursor !== null },
    });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
