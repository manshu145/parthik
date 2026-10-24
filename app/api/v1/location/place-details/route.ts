import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { getLocationService } from '@/modules/location';
import { placeDetailsQuerySchema } from '@/modules/location/location.schema';

/**
 * GET /api/v1/location/place-details (docs/API_SPEC.md §3.4)
 *
 * Resolves a chosen suggestion to a full address AND its serviceability in one
 * call, because the two are always needed together — a separate round trip would
 * only add a visible delay to the selection UI.
 *
 * The same `sessionToken` used for autocomplete must be passed here to close the
 * Places billing session.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const url = new URL(request.url);
    const parsed = placeDetailsQuerySchema.safeParse({
      placeId: url.searchParams.get('placeId') ?? '',
      sessionToken: url.searchParams.get('sessionToken') ?? '',
    });

    if (!parsed.success) {
      throw new ValidationError(
        'Invalid place request.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getLocationService();
    const { place, serviceability } = await service.resolvePlace(
      parsed.data.placeId,
      parsed.data.sessionToken
    );

    if (!place) {
      throw new NotFoundError('That address could not be found.');
    }

    return apiSuccess({ place, serviceability }, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
