import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { ProductGrid } from '@/components/catalog/product-grid';
import { CategoryGrid } from '@/components/catalog/category-card';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbJsonLd, collectionPageJsonLd } from '@/lib/seo/json-ld';
import { canonicalUrl, publicPageMetadata, siteName } from '@/lib/seo/metadata';
import { redirectIfRenamed } from '@/lib/seo/managed-redirect';
import { buildCatalogHref, buildSortOptions, firstValue } from '@/lib/catalog/query';
import { logger } from '@/lib/logger';
import { getCatalogService } from '@/modules/catalog';
import { productListQuerySchema } from '@/modules/catalog/catalog.schema';
import { cn } from '@/lib/utils';

/**
 * Category listing (docs/ROUTES.md §4).
 *
 * Filters and sorting are URL search params, so a filtered view is shareable and
 * crawlable, and the whole toolbar works without JavaScript.
 *
 * The listing includes the products of CHILD categories. Browsing "Fruits &
 * Vegetables" must not look empty just because products are attached to its
 * children.
 */

const DEFAULT_SORT = 'createdAt:desc';

type SearchParams = Record<string, string | string[] | undefined>;

async function loadCategory(slug: string, locale: 'en' | 'hi', searchParams: SearchParams) {
  // Only the browsing parameters are forwarded; anything else (utm_*, etc.) is
  // ignored rather than rejected, so shared links keep working.
  const candidate = {
    ...(firstValue(searchParams, 'sort') ? { sort: firstValue(searchParams, 'sort') } : {}),
    ...(firstValue(searchParams, 'cursor') ? { cursor: firstValue(searchParams, 'cursor') } : {}),
    ...(firstValue(searchParams, 'inStock')
      ? { inStock: firstValue(searchParams, 'inStock') }
      : {}),
  };

  const parsed = productListQuerySchema.safeParse(candidate);
  // An invalid sort or cursor falls back to defaults rather than 422-ing a page a
  // customer reached from a link.
  const query = parsed.success ? parsed.data : {};

  const service = await getCatalogService();
  return service.getCategoryPage(slug, locale, query);
}

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
    result = await service.getCategoryPage(slug, locale, {});
  } catch {
    // Metadata must never be the thing that fails a page render.
    return {};
  }

  // Same known 200-status limitation as the product page; see the note there.
  if (!result) notFound();

  return publicPageMetadata({
    title: result.seo.title,
    description: result.seo.description ?? result.category.name,
    path: `/category/${slug}`,
    locale,
    siteName: await siteName(locale),
  });
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const resolvedSearchParams = await searchParams;
  const tCatalog = await getTranslations('catalog');

  let result;
  try {
    result = await loadCategory(slug, locale, resolvedSearchParams);
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

  // Same reasoning as the product page: a renamed category keeps its links.
  if (!result) {
    await redirectIfRenamed(`/category/${slug}`);
    notFound();
  }

  const { category, products } = result;
  const basePath = `/category/${slug}`;

  const sortOptions = buildSortOptions(
    basePath,
    resolvedSearchParams,
    [
      { value: DEFAULT_SORT, label: tCatalog('sortNewest') },
      { value: 'pricePaise:asc', label: tCatalog('sortPriceAsc') },
      { value: 'pricePaise:desc', label: tCatalog('sortPriceDesc') },
      { value: 'soldCount:desc', label: tCatalog('sortPopular') },
    ],
    DEFAULT_SORT
  );

  const inStockOnly = firstValue(resolvedSearchParams, 'inStock') === 'true';
  const hasFilters = inStockOnly;

  const labels = {
    outOfStock: tCatalog('outOfStock'),
    discountBadgeTemplate: tCatalog.raw('discountBadge') as string,
    mrpLabel: tCatalog('mrpLabel'),
    imagePlaceholder: tCatalog('imagePlaceholder'),
  };

  return (
    <PageShell title={category.name} description={category.description ?? undefined}>
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: tCatalog('breadcrumbHome'), url: canonicalUrl('/', locale) },
            { name: tCatalog('allCategories'), url: canonicalUrl('/categories', locale) },
            ...category.ancestors.map((ancestor) => ({
              name: ancestor.name,
              url: canonicalUrl(`/category/${ancestor.slug}`, locale),
            })),
            { name: category.name },
          ]),
          collectionPageJsonLd({
            name: category.name,
            description: category.description,
            url: canonicalUrl(basePath, locale),
            locale,
            itemCount: products.items.length,
          }),
        ]}
      />

      <div className="flex flex-col gap-6">
        {/* Breadcrumbs: visible, not only in structured data. */}
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
            {category.ancestors.map((ancestor) => (
              <li key={ancestor.id} className="flex items-center gap-1">
                <span aria-hidden="true">/</span>
                <Link
                  href={`/category/${ancestor.slug}`}
                  className="hover:text-foreground underline-offset-2 hover:underline"
                >
                  {ancestor.name}
                </Link>
              </li>
            ))}
            <li className="flex items-center gap-1">
              <span aria-hidden="true">/</span>
              <span className="text-foreground font-medium">{category.name}</span>
            </li>
          </ol>
        </nav>

        {category.children.length > 0 && (
          <section aria-labelledby="subcategories">
            <h2 id="subcategories" className="mb-3 text-sm font-semibold">
              {tCatalog('subcategories')}
            </h2>
            <CategoryGrid
              categories={category.children}
              placeholderLabel={tCatalog('imagePlaceholder')}
            />
          </section>
        )}

        {/* Toolbar: links, so it needs no JavaScript and each state is a real URL. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">{tCatalog('sortLabel')}:</span>
          {sortOptions.map((option) => (
            <Link
              key={option.value}
              href={option.href}
              aria-current={option.isActive ? 'true' : undefined}
              data-testid="catalog-sort-option"
              className={cn(
                'rounded-[var(--radius-pill)] border px-3 py-1 text-xs',
                option.isActive
                  ? 'bg-primary text-primary-foreground border-[var(--color-primary)]'
                  : 'border-border hover:bg-muted'
              )}
            >
              {option.label}
            </Link>
          ))}

          <Link
            href={buildCatalogHref(basePath, resolvedSearchParams, {
              inStock: inStockOnly ? null : 'true',
            })}
            aria-pressed={inStockOnly}
            data-testid="catalog-filter-instock"
            className={cn(
              'ml-auto rounded-[var(--radius-pill)] border px-3 py-1 text-xs',
              inStockOnly
                ? 'bg-primary text-primary-foreground border-[var(--color-primary)]'
                : 'border-border hover:bg-muted'
            )}
          >
            {tCatalog('filterInStock')}
          </Link>
        </div>

        <p className="text-muted-foreground text-sm" data-testid="catalog-count">
          {tCatalog('productCount', { count: products.items.length })}
        </p>

        {products.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? tCatalog('emptyFilteredTitle') : tCatalog('emptyCategoryTitle')}
            description={
              hasFilters
                ? tCatalog('emptyFilteredDescription')
                : tCatalog('emptyCategoryDescription')
            }
          />
        ) : (
          <ProductGrid products={products.items} locale={locale} labels={labels} />
        )}

        {/* Cursor pagination as a plain link, so it is crawlable and works without JS. */}
        {products.nextCursor && (
          <Link
            href={buildCatalogHref(basePath, resolvedSearchParams, {
              cursor: products.nextCursor,
            })}
            data-testid="catalog-load-more"
            className="border-border hover:bg-muted mx-auto rounded-[var(--radius-control)] border px-4 py-2 text-sm"
          >
            {tCatalog('loadMore')}
          </Link>
        )}
      </div>
    </PageShell>
  );
}
