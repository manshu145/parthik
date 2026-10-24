import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getCashService } from '@/modules/cash';

/**
 * GET /api/v1/admin/cash/deposits?status= — the verification queue (`cash:view`).
 *
 * Defaults to DECLARED, which is the only status that needs anybody's attention: a queue that
 * opens on "everything ever deposited" is a queue nobody works through.
 */

export const dynamic = 'force-dynamic';

const STATUSES = ['DECLARED', 'VERIFIED', 'REJECTED', 'PARTIAL'] as const;

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    await requireCurrentPermission('cash:view');

    const url = new URL(request.url);
    const requested = url.searchParams.get('status') ?? 'DECLARED';

    if (!(STATUSES as readonly string[]).includes(requested)) {
      throw new ValidationError('Unknown deposit status.');
    }

    const cash = await getCashService();
    const deposits = await cash.verificationQueue(requested as (typeof STATUSES)[number]);

    const response = apiSuccess(
      { status: requested, deposits },
      { meta: { requestId, locale, total: deposits.length } }
    );

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
