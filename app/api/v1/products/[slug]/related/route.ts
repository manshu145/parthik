import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { publicCacheHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getCatalogService } from '@/modules/catalog';
import {
  productSlugParamSchema,
  relatedProductsQuerySchema,
} from '@/modules/catalog/catalog.schema';

/**
 * GET /api/v1/products/[slug]/related (docs/API_SPEC.md §5)
 *
 * Same-category products, excluding the product itself.
 *
 * Returns an empty list rather than 404 for an unknown slug: "no related products"
 * is a legitimate outcome for any product, and a missing-recommendations block must
 * never be able to fail a product page.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const params = productSlugParamSchema.safeParse(await context.params);

    if (!params.success) {
      throw new ValidationError(
        'Invalid product.',
        params.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const query = relatedProductsQuerySchema.safeParse(limitParam ? { limit: limitParam } : {});

    if (!query.success) {
      throw new ValidationError(
        'Invalid limit.',
        query.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getCatalogService();
    const products = await service.getRelatedProducts(
      params.data.slug,
      locale,
      query.data.limit ?? 8
    );

    const response = apiSuccess(
      { products },
      { meta: { requestId, locale, total: products.length } }
    );

    for (const [header, value] of Object.entries(publicCacheHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
