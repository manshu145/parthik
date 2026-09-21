import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getCashService } from '@/modules/cash';

/**
 * GET /api/v1/admin/cash/variances — deliveries where the cash did not match (`cash:view`).
 *
 * Reads the partial index `deliveries_cod_variance_idx`, so the report stays cheap however many
 * thousands of clean deliveries sit alongside. A variance is never resolved automatically: the
 * whole point of recording it is that a person decides whether it was a counting error, a discount
 * somebody gave away, or a shortfall.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    await requireCurrentPermission('cash:view');

    const cash = await getCashService();
    const variances = await cash.variances();

    const response = apiSuccess(
      {
        variances,
        // Signed: positive means the driver collected LESS than was owed.
        netVariancePaise: variances.reduce((sum, row) => sum + row.variancePaise, 0),
      },
      { meta: { requestId, locale, total: variances.length } }
    );

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
