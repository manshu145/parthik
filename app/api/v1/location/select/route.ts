import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { ValidationError } from '@/lib/errors';
import { clearZoneCookie, setZoneCookie } from '@/lib/http/zone-cookie';
import { getLocationService } from '@/modules/location';
import { selectLocationBodySchema } from '@/modules/location/location.schema';

/**
 * POST /api/v1/location/select
 *
 * Records the customer's chosen delivery location in a cookie so it survives a
 * reload and is readable during server rendering.
 *
 * Takes a PINCODE, not a zone id. The zone is resolved server-side from the zone
 * tables, so a client cannot declare itself serviceable by naming a zone.
 *
 * An unserviceable pincode is still stored: the customer chose it, and the UI needs
 * to keep showing "we don't deliver to 110001 yet" rather than silently forgetting.
 * The cookie records `isServiceable: false`, and nothing grants purchase rights off
 * this value — checkout re-verifies.
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

    const parsed = selectLocationBodySchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        'Enter a valid 6-digit PIN code.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getLocationService();
    const result = await service.checkServiceability(parsed.data.pincode);

    const response = apiSuccess(result, { meta: { requestId } });

    setZoneCookie(response, {
      pincode: result.pincode,
      zoneId: result.zone?.id ?? null,
      city: result.zone?.city ?? null,
      // Prefer the caller's label (e.g. "Palasia Square") for a friendlier header,
      // falling back to the city and then the pincode itself.
      label: parsed.data.label ?? result.zone?.city ?? result.pincode,
      isServiceable: result.isServiceable,
    });

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}

/**
 * DELETE /api/v1/location/select
 *
 * Clears the chosen location. Needed so a customer can reset a wrong detection
 * without clearing site data by hand.
 */
export function DELETE(request: Request) {
  const requestId = requestIdFrom(request);
  const response = apiSuccess({ cleared: true }, { meta: { requestId } });
  clearZoneCookie(response);
  return response;
}
