import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { ValidationError } from '@/lib/errors';
import { getLocationService } from '@/modules/location';
import { routeEstimateBodySchema } from '@/modules/location/location.schema';

/**
 * POST /api/v1/location/route-estimate (docs/API_SPEC.md §3.5)
 *
 * Road distance and duration for one origin/destination pair.
 *
 * POST rather than GET because Routes calls are metered and must not be
 * cacheable-by-URL or triggerable by a crawler following a link.
 *
 * Returns straight distance/duration only — it does NOT compute a delivery fee.
 * Fees depend on zone configuration and order value, and are produced by the
 * location service so one implementation serves cart, checkout and order creation.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A JSON body is required.');
    }

    const parsed = routeEstimateBodySchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        'Invalid origin or destination.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getLocationService();
    const estimate = await service.estimateRoute(parsed.data.origin, parsed.data.destination);

    return apiSuccess({ estimate }, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
