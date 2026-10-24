import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { ValidationError } from '@/lib/errors';
import { getLocationService } from '@/modules/location';
import { reverseGeocodeQuerySchema } from '@/modules/location/location.schema';

/**
 * GET /api/v1/location/reverse-geocode?lat=&lng= (docs/API_SPEC.md §3.2)
 *
 * Turns a browser Geolocation coordinate into an address and its serviceability.
 *
 * The pincode is taken from the GEOCODER, never from the client, so a client cannot
 * assert that it sits inside a serviceable zone.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const url = new URL(request.url);
    const parsed = reverseGeocodeQuerySchema.safeParse({
      lat: url.searchParams.get('lat') ?? '',
      lng: url.searchParams.get('lng') ?? '',
    });

    if (!parsed.success) {
      throw new ValidationError(
        'Invalid coordinates.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getLocationService();
    const { place, serviceability } = await service.resolveCoordinates({
      latitude: parsed.data.lat,
      longitude: parsed.data.lng,
    });

    // A coordinate that resolves to nothing is a legitimate outcome (out of
    // coverage, sea, unmapped area), not an error — the UI asks for a pincode
    // instead.
    return apiSuccess({ place, serviceability }, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
