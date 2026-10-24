import { requireCurrentActor } from '@/lib/auth/current-actor';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getCashService } from '@/modules/cash';
import { getDeliveryService } from '@/modules/delivery';

/**
 * GET /api/v1/driver/cash/ledger — every movement, newest first.
 *
 * The append-only ledger is what makes a disputed float resolvable: the driver can see the same
 * rows the office sees, which is a very different conversation from "the app says you owe us this".
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor') ?? undefined;

    const [deliveries, cash] = await Promise.all([getDeliveryService(), getCashService()]);
    const driver = await deliveries.requireDriver(actor.userId);

    const page = await cash.ledgerFor(driver.id, { limit: 30, ...(cursor ? { cursor } : {}) });

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
