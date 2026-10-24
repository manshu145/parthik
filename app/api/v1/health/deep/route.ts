import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { getHealthReport } from '@/lib/observability/health';

/**
 * Deep health check (docs/API_SPEC.md §10, master spec §30).
 *
 * Reports configuration readiness of every dependency and feeds the admin System
 * Health screen. This is also the observable proof that the application degrades
 * safely: with no credentials at all it returns 200 with providers marked
 * `not_configured`, rather than failing to boot.
 *
 * NOTE: currently unauthenticated because it exposes only presence/absence of
 * configuration — no values, no hostnames, no secrets. It MUST be restricted to
 * `system:view` (or an internal token) once RBAC exists in TASK 003, per
 * docs/API_SPEC.md §10.
 */

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const report = getHealthReport();

    // 503 only when a REQUIRED component is failing, so orchestrators can act on
    // it without being tripped by an intentionally unconfigured optional provider.
    const status = report.status === 'unhealthy' ? 503 : 200;

    return apiSuccess(report, { status, meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
