import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { publicCacheHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getSearchService } from '@/modules/search';
import { suggestQuerySchema } from '@/modules/search/search.schema';

/**
 * GET /api/v1/search/suggest?q=
 *
 * Typeahead completions only.
 *
 * A DELIBERATE ADDITION to docs/API_SPEC.md §5, which lists suggestions as part of
 * `/search`. The full search endpoint runs the ranked product query and hydrates
 * every result; calling that on each keystroke would do that work for a payload the
 * dropdown throws away. This is the bounded, cheap path — names and slugs, nothing
 * else.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const url = new URL(request.url);
    const raw: Record<string, string> = {};

    for (const [key, value] of url.searchParams.entries()) {
      if (key === 'locale') continue;
      if (value === '') continue;
      raw[key] = value;
    }

    const parsed = suggestQuerySchema.safeParse(raw);

    if (!parsed.success) {
      throw new ValidationError(
        'Invalid suggestion request.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getSearchService();
    const suggestions = await service.suggest(parsed.data.q, locale, parsed.data.limit ?? 8);

    const response = apiSuccess(
      { suggestions },
      { meta: { requestId, locale, total: suggestions.length } }
    );

    for (const [header, value] of Object.entries(publicCacheHeaders(locale, 60))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
