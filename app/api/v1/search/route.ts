import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { publicCacheHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getSearchService } from '@/modules/search';
import { searchQuerySchema } from '@/modules/search/search.schema';

/**
 * GET /api/v1/search?q= (docs/API_SPEC.md §5)
 *
 * Products, matching categories and suggestions in one response.
 *
 * Offset paginated rather than cursor paginated: results are ordered by RELEVANCE,
 * and a keyset cursor needs a stable, monotonic sort column. Relevance is neither —
 * it changes with the term and is not stored — so a cursor would be meaningless.
 *
 * Cached briefly and publicly: the same term returns the same results for everyone
 * in a locale, and search is the cheapest place for a thundering herd to appear.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const url = new URL(request.url);
    const raw: Record<string, string> = {};

    // `locale` is consumed by locale resolution, not by the schema, so it is
    // skipped rather than tripping `.strict()`.
    for (const [key, value] of url.searchParams.entries()) {
      if (key === 'locale') continue;
      if (value === '') continue;
      raw[key] = value;
    }

    const parsed = searchQuerySchema.safeParse(raw);

    if (!parsed.success) {
      throw new ValidationError(
        'Invalid search request.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getSearchService();
    const results = await service.search(parsed.data, locale);

    // Suggestions accompany the first page only; repeating them under every page is
    // noise, and they are what the typeahead endpoint is for.
    const suggestions = results.page === 1 ? await service.suggest(parsed.data.q, locale, 6) : [];

    const response = apiSuccess(
      {
        term: results.term,
        products: results.products,
        categories: results.categories,
        suggestions,
      },
      {
        meta: {
          requestId,
          locale,
          page: results.page,
          pageSize: results.pageSize,
          total: results.total,
          hasMore: results.hasMore,
        },
      }
    );

    // Short TTL: a newly published product should become findable in minutes, not
    // after a cache lifetime.
    for (const [header, value] of Object.entries(publicCacheHeaders(locale, 60))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
