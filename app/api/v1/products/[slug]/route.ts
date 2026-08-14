import { NotFoundError, ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { publicCacheHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getCatalogService } from '@/modules/catalog';
import { productSlugParamSchema } from '@/modules/catalog/catalog.schema';

/**
 * GET /api/v1/products/[slug] (docs/API_SPEC.md §5)
 *
 * Product detail: variants, images, store, resolved SEO and related products.
 *
 * ROUTE SHAPE NOTE: the spec lists `/products/[slug]` alongside
 * `/products/[id]/availability` and `/products/[id]/related`. Next.js cannot have
 * two differently-named dynamic segments at the same level, so all three are keyed
 * by SLUG. That is also the better contract — internal ids should not appear in
 * public URLs.
 *
 * Cached, but stock is NOT trusted from this payload: the page re-reads
 * availability from `/products/[slug]/availability` on every request.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const parsed = productSlugParamSchema.safeParse(await context.params);

    if (!parsed.success) {
      throw new ValidationError(
        'Invalid product.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getCatalogService();
    const result = await service.getProductPage(parsed.data.slug, locale);

    if (!result) {
      throw new NotFoundError('That product could not be found.');
    }

    const response = apiSuccess(
      { product: result.product, related: result.related, seo: result.seo },
      { meta: { requestId, locale } }
    );

    for (const [header, value] of Object.entries(publicCacheHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
