import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getCashService } from '@/modules/cash';

/**
 * GET /api/v1/admin/cash/drivers — who is holding the platform's money (`cash:view`).
 *
 * `totalOutstandingPaise` is the number that matters at a glance: it is the platform's live cash
 * exposure, sitting in pockets rather than in a bank account.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    await requireCurrentPermission('cash:view');

    const cash = await getCashService();
    const overview = await cash.adminOverview();

    const response = apiSuccess(overview, {
      meta: { requestId, locale, total: overview.drivers.length },
    });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
