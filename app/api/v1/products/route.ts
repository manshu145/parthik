import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { publicCacheHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getCatalogService } from '@/modules/catalog';
import { productListQuerySchema } from '@/modules/catalog/catalog.schema';

/**
 * GET /api/v1/products (docs/API_SPEC.md §5)
 *
 * Cursor-paginated product feed with explicit, named filters.
 *
 * Price filters are `minPricePaise` / `maxPricePaise`, not `minPrice` / `maxPrice`.
 * §1.2 requires every monetary field to carry an explicit `…Paise` suffix, and an
 * unsuffixed price parameter is ambiguous between rupees and paise — exactly the
 * ambiguity that produces a 100× error.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const url = new URL(request.url);
    const raw: Record<string, string> = {};

    // Only known parameters are forwarded. `locale` is consumed by locale
    // resolution rather than being a filter, so it is skipped instead of tripping
    // the schema's `.strict()`.
    for (const [key, value] of url.searchParams.entries()) {
      if (key === 'locale') continue;
      if (value === '') continue;
      raw[key] = value;
    }

    const parsed = productListQuerySchema.safeParse(raw);

    if (!parsed.success) {
      throw new ValidationError(
        'Invalid product query.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getCatalogService();
    const result = await service.listProducts(parsed.data, locale);

    const response = apiSuccess(
      { products: result.items },
      {
        meta: {
          requestId,
          locale,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
      }
    );

    for (const [header, value] of Object.entries(publicCacheHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
