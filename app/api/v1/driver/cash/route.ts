import { requireCurrentActor } from '@/lib/auth/current-actor';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getCashService } from '@/modules/cash';
import { getDeliveryService } from '@/modules/delivery';

/**
 * GET /api/v1/driver/cash — the driver's float (docs/API_SPEC.md §6.2).
 *
 * Every number here is DERIVED from the ledger rather than read from a running total, because a
 * stored balance that drifts from its ledger cannot be argued with — and this is the number a
 * driver is personally accountable for.
 *
 * `isCodBlocked` is computed by the same service dispatch uses, so the screen and the offer queue
 * cannot disagree. A driver told they are fine while dispatch quietly skips them is the worst
 * possible version of this feature.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const [deliveries, cash] = await Promise.all([getDeliveryService(), getCashService()]);
    const driver = await deliveries.requireDriver(actor.userId);
    const position = await cash.positionFor(driver.id);

    const response = apiSuccess(position, { meta: { requestId, locale } });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
