import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { publicCacheHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getCatalogService } from '@/modules/catalog';

/**
 * GET /api/v1/categories (docs/API_SPEC.md §5)
 *
 * Public, heavily cached category tree, already localised with English fallback —
 * clients never receive a translation map and never implement fallback themselves
 * (D-33).
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const service = await getCatalogService();
    const categories = await service.getCategoryTree(locale);

    const response = apiSuccess(
      { categories },
      { meta: { requestId, total: categories.length, locale } }
    );

    for (const [header, value] of Object.entries(publicCacheHeaders(locale, 600))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
