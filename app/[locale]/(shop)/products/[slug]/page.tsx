import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { PageShell } from '@/components/layout/page-shell';
import { ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { ProductGrid } from '@/components/catalog/product-grid';
import { ProductImage } from '@/components/catalog/product-image';
import { ProductPrice } from '@/components/catalog/product-price';
import { AddToCartButton } from '@/components/cart/add-to-cart-button';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbJsonLd, productJsonLd } from '@/lib/seo/json-ld';
import { canonicalUrl, publicPageMetadata, siteName } from '@/lib/seo/metadata';
import { redirectIfRenamed } from '@/lib/seo/managed-redirect';
import { imageUrlForKey } from '@/lib/catalog/image';
import { logger } from '@/lib/logger';
import { getCatalogService } from '@/modules/catalog';

/**
 * Product detail (docs/ROUTES.md §4).
 *
 * PRICE AND STOCK ARE RE-READ ON EVERY REQUEST. The page content is cacheable, but
 * availability comes from a separate uncached read and is what both the UI and the
 * `Product` JSON-LD report. Serving cached stock is how a customer is shown an
 * in-stock product that is already gone — and how Google is told the same.
 *
 * There is deliberately no "Add to cart" control: the cart is TASK 008.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};

  let result;
  try {
    const service = await getCatalogService();
    result = await service.getProductPage(slug, locale);
  } catch {
    // An infrastructure failure must not be reported as "not found"; the page
    // renders its error state instead.
    return {};
  }

  // Raised in metadata as well as the page body so the missing-product path is
  // decided once, before any page work happens.
  // KNOWN LIMITATION: this renders the branded 404 UI but the HTTP status is 200.
  // Next.js applies automatic Suspense boundaries to dynamic routes, so the
  // response shell is committed before `notFound()` can set a status — removing
  // `loading.tsx` does not change it (verified). The mitigation is in
  // app/[locale]/not-found.tsx, which sets `robots: noindex` so a soft 404 is never
  // indexed. Tracked as a known issue rather than papered over.
  if (!result) notFound();

  return publicPageMetadata({
    title: result.seo.title,
    description: result.seo.description ?? result.product.name,
    path: `/products/${slug}`,
    locale,
    siteName: await siteName(locale),
    // A product share should show the product, not the generic site card. Null when
    // the product has no image, which falls back to the site card rather than
    // emitting a broken image URL.
    imageUrl: imageUrlForKey(result.product.primaryImageKey),
  });
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const tCatalog = await getTranslations('catalog');
  const tLocation = await getTranslations('location');

  let page;
  let availability;
  try {
    const service = await getCatalogService();
    page = await service.getProductPage(slug, locale);

    if (page) {
      // The live read. Separate from the cacheable page data on purpose.
      availability = await service.getAvailability(page.product.id);
    }
  } catch (error) {
    logger.exception(error);
    return (
      <PageShell title={slug}>
        <ErrorState
          title={tCatalog('unavailableTitle')}
          description={tCatalog('unavailableDescription')}
        />
      </PageShell>
    );
  }

  // A renamed product must keep its inbound links and rankings, so the managed
  // `redirects` table is consulted before this becomes a 404 (docs/ROUTES.md §11).
  if (!page) {
    await redirectIfRenamed(`/products/${slug}`);
    notFound();
  }

  const { product, related } = page;
  const defaultVariant =
    product.variants.find((variant) => variant.isDefault) ?? product.variants[0];

  // Trust the live read; fall back to the page's derived value only if the
  // availability call returned nothing.
  const inStock = availability?.inStock ?? product.inStock;
  const livePricePaise =
    availability?.variants.find((variant) => variant.isDefault)?.pricePaise ??
    defaultVariant?.pricePaise ??
    product.pricePaise;
  const liveMrpPaise =
    availability?.variants.find((variant) => variant.isDefault)?.mrpPaise ??
    defaultVariant?.mrpPaise ??
    product.mrpPaise;

  const discountPercent =
    liveMrpPaise > livePricePaise
      ? Math.round(((liveMrpPaise - livePricePaise) / liveMrpPaise) * 100)
      : null;

  const labels = {
    outOfStock: tCatalog('outOfStock'),
    discountBadgeTemplate: tCatalog.raw('discountBadge') as string,
    mrpLabel: tCatalog('mrpLabel'),
    imagePlaceholder: tCatalog('imagePlaceholder'),
  };

  return (
    <PageShell title={product.name}>
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: tCatalog('breadcrumbHome'), url: canonicalUrl('/', locale) },
            { name: tCatalog('allCategories'), url: canonicalUrl('/categories', locale) },
            {
              name: product.categoryName,
              url: canonicalUrl(`/category/${product.categorySlug}`, locale),
            },
            { name: product.name },
          ]),
          productJsonLd({
            name: product.name,
            description: product.description ?? product.shortDescription,
            url: canonicalUrl(`/products/${product.slug}`, locale),
            locale,
            sku: defaultVariant?.sku ?? null,
            brandName: product.brandName,
            pricePaise: livePricePaise,
            // Live, never cached.
            inStock,
            ratingAvg: product.ratingAvg,
            ratingCount: product.ratingCount,
            imageUrl: imageUrlForKey(product.primaryImageKey),
          }),
        ]}
      />

      <div className="flex flex-col gap-8">
        <nav aria-label={tCatalog('allCategories')} className="text-muted-foreground text-sm">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link
                href="/categories"
                className="hover:text-foreground underline-offset-2 hover:underline"
              >
                {tCatalog('allCategories')}
              </Link>
            </li>
            <li className="flex items-center gap-1">
              <span aria-hidden="true">/</span>
              <Link
                href={`/category/${product.categorySlug}`}
                className="hover:text-foreground underline-offset-2 hover:underline"
              >
                {product.categoryName}
              </Link>
            </li>
          </ol>
        </nav>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <ProductImage
              storageKey={product.primaryImageKey}
              alt={product.primaryImageAlt}
              placeholderLabel={tCatalog('imagePlaceholder')}
              sizes="(min-width: 768px) 40vw, 90vw"
            />
          </div>

          <div className="flex flex-col gap-4">
            {product.usedFallbackLocale && locale !== 'en' && (
              // Honest about a translation gap rather than passing English off as
              // Hindi content.
              <p
                className="text-muted-foreground text-xs"
                data-testid="product-translation-pending"
              >
                {tCatalog('translationPending')}
              </p>
            )}

            {product.shortDescription && (
              <p className="text-muted-foreground text-sm">{product.shortDescription}</p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <ProductPrice
                pricePaise={livePricePaise}
                mrpPaise={liveMrpPaise}
                discountPercent={discountPercent}
                locale={locale}
                mrpLabel={tCatalog('mrpLabel')}
                size="lg"
              />
              {discountPercent !== null && (
                <Badge variant="success">
                  {labels.discountBadgeTemplate.replace('{percent}', String(discountPercent))}
                </Badge>
              )}
            </div>

            {product.unitLabel && (
              <p className="text-sm">
                <span className="text-muted-foreground">{tCatalog('unitLabel')}: </span>
                {product.unitLabel}
              </p>
            )}

            <p data-testid="product-stock">
              <Badge variant={inStock ? 'success' : 'danger'}>
                {inStock ? tCatalog('inStock') : tCatalog('outOfStock')}
              </Badge>
            </p>

            {/* Disabled rather than hidden when out of stock, so the control's
                position is stable and the reason is visible right above it. */}
            {defaultVariant && (
              <AddToCartButton variantId={defaultVariant.id} disabled={!inStock} block />
            )}

            <dl className="border-border flex flex-col gap-1 border-t pt-4 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{tCatalog('soldBy')}</dt>
                <dd>{product.store.name}</dd>
              </div>
              {product.store.city && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{tLocation('deliverTo')}</dt>
                  <dd>{tCatalog('deliveredFrom', { city: product.store.city })}</dd>
                </div>
              )}
              {product.store.avgPrepTimeMinutes !== null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{tCatalog('prepTimeLabel')}</dt>
                  <dd>{tCatalog('prepTime', { count: product.store.avgPrepTimeMinutes })}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">COD</dt>
                <dd>
                  {product.store.codEnabled ? tCatalog('codAvailable') : tCatalog('codUnavailable')}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {product.description && (
          <section aria-labelledby="about-product">
            <h2 id="about-product" className="mb-2 text-base font-semibold">
              {tCatalog('aboutProduct')}
            </h2>
            <p className="text-muted-foreground text-sm whitespace-pre-line">
              {product.description}
            </p>
          </section>
        )}

        {related.length > 0 && (
          <section aria-labelledby="related-products">
            <h2 id="related-products" className="mb-3 text-base font-semibold">
              {tCatalog('relatedTitle')}
            </h2>
            <ProductGrid products={related} locale={locale} labels={labels} />
          </section>
        )}
      </div>
    </PageShell>
  );
}
