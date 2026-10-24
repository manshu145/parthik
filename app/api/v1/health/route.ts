import { apiSuccess, requestIdFrom } from '@/lib/http/api-response';

/**
 * Liveness probe (docs/API_SPEC.md §10, master spec §30).
 *
 * Deliberately cheap: no database, cache or provider calls, so it stays useful
 * as an uptime check and cannot be turned into an amplification vector.
 * Dependency status lives at /api/v1/health/deep.
 */

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return apiSuccess(
    { status: 'ok', service: 'parthik' },
    { meta: { requestId: requestIdFrom(request) } }
  );
}
