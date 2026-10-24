import { NotFoundError, ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { publicCacheHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getCatalogService } from '@/modules/catalog';
import { categorySlugParamSchema } from '@/modules/catalog/catalog.schema';

/**
 * GET /api/v1/categories/[slug] (docs/API_SPEC.md §5)
 *
 * Category, its children, breadcrumb ancestors and resolved SEO copy.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const parsed = categorySlugParamSchema.safeParse(await context.params);

    if (!parsed.success) {
      throw new ValidationError(
        'Invalid category.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getCatalogService();
    const result = await service.getCategoryPage(parsed.data.slug, locale, {});

    if (!result) {
      throw new NotFoundError('That category could not be found.');
    }

    const response = apiSuccess(
      {
        category: result.category,
        products: result.products.items,
        seo: result.seo,
      },
      {
        meta: {
          requestId,
          locale,
          hasMore: result.products.hasMore,
          nextCursor: result.products.nextCursor,
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
