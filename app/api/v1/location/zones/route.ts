import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { getLocationService } from '@/modules/location';

/**
 * GET /api/v1/location/zones
 *
 * Public list of active delivery areas, so a customer outside coverage can see
 * where we DO deliver instead of only being told "no".
 *
 * Returns city/zone names only. Pincode lists are operational detail and are not
 * exposed on a public surface.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const service = await getLocationService();
    const zones = await service.listServiceableZones();

    return apiSuccess({ zones }, { meta: { requestId, total: zones.length } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
