import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { ValidationError } from '@/lib/errors';
import { getLocationService } from '@/modules/location';
import { serviceabilityQuerySchema } from '@/modules/location/location.schema';

/**
 * GET /api/v1/location/serviceability?pincode=452001 (docs/API_SPEC.md §3.1)
 *
 * Public. Answers "do you deliver here?" and returns the zone's advertised terms.
 *
 * The response deliberately does NOT distinguish an unknown pincode from a
 * deactivated one — both are simply not serviceable, and the difference is internal
 * operational detail.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const url = new URL(request.url);
    const parsed = serviceabilityQuerySchema.safeParse({
      pincode: url.searchParams.get('pincode') ?? '',
    });

    if (!parsed.success) {
      throw new ValidationError(
        'Enter a valid 6-digit PIN code.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getLocationService();
    const result = await service.checkServiceability(parsed.data.pincode);

    return apiSuccess(result, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
