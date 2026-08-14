import { NotFoundError, ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getCatalogService } from '@/modules/catalog';
import { productSlugParamSchema } from '@/modules/catalog/catalog.schema';

/**
 * GET /api/v1/products/[slug]/availability (docs/API_SPEC.md §5)
 *
 * Live price and stock — the ONE catalog endpoint that must never be cached.
 *
 * The product page is served from ISR, so its payload can be minutes old. Stock
 * moves in seconds. Trusting the cached value is how a customer adds the last unit
 * to a cart that is already sold out, which surfaces later as a failed order rather
 * than an honest "out of stock" label.
 *
 * `Cache-Control: no-store` is therefore load-bearing, not boilerplate.
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
    const availability = await service.getAvailabilityBySlug(parsed.data.slug, locale);

    if (!availability) {
      throw new NotFoundError('That product could not be found.');
    }

    const response = apiSuccess({ availability }, { meta: { requestId, locale } });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
