import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { ValidationError } from '@/lib/errors';
import { getLocationService } from '@/modules/location';
import { autocompleteQuerySchema } from '@/modules/location/location.schema';

/**
 * GET /api/v1/location/autocomplete (docs/API_SPEC.md §3.3)
 *
 * Server-side proxy for Places Autocomplete. The Maps key is a SERVER key and must
 * never reach the browser (docs/SECURITY.md), so the client cannot call Google
 * directly — this route exists specifically to hold that boundary.
 *
 * `sessionToken` is mandatory: Google bills autocomplete per session rather than
 * per keystroke when one is supplied, so omitting it multiplies cost. The
 * requirement is enforced against the mock too, so the discipline cannot rot in
 * development.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const url = new URL(request.url);
    const raw = {
      q: url.searchParams.get('q') ?? '',
      sessionToken: url.searchParams.get('sessionToken') ?? '',
      ...(url.searchParams.get('originLat')
        ? { originLat: url.searchParams.get('originLat') }
        : {}),
      ...(url.searchParams.get('originLng')
        ? { originLng: url.searchParams.get('originLng') }
        : {}),
    };

    const parsed = autocompleteQuerySchema.safeParse(raw);

    if (!parsed.success) {
      throw new ValidationError(
        'Invalid search request.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const { q, sessionToken, originLat, originLng } = parsed.data;

    const service = await getLocationService();
    const suggestions = await service.suggestAddresses(
      q,
      sessionToken,
      originLat !== undefined && originLng !== undefined
        ? { latitude: originLat, longitude: originLng }
        : undefined
    );

    return apiSuccess({ suggestions }, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
