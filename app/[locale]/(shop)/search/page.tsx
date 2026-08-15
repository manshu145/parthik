import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { ProductGrid } from '@/components/catalog/product-grid';
import { CategoryGrid } from '@/components/catalog/category-card';
import { buildCatalogHref, buildSortOptions, firstValue } from '@/lib/catalog/query';
import { logger } from '@/lib/logger';
import { getSearchService } from '@/modules/search';
import { searchQuerySchema } from '@/modules/search/search.schema';
import { MIN_SEARCH_TERM_LENGTH } from '@/modules/search/search.types';
import { cn } from '@/lib/utils';

/**
 * Search results (docs/ROUTES.md §4).
 *
 * `noindex`: result pages are thin and duplicative of category pages, and an
 * unbounded query string would let crawlers generate limitless URLs
 * (docs/ROUTES.md §11).
 *
 * Filters, sorting and paging are URL search params, exactly as on the category
 * page, so a result set is shareable and the whole toolbar works without
 * JavaScript.
 */

const DEFAULT_SORT = 'relevance';

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.search' });

  return {
    title: t('title'),
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const resolved = await searchParams;
  const t = await getTranslations('search');
  const tPage = await getTranslations('pages.search');
  const tCatalog = await getTranslations('catalog');

  const rawTerm = (firstValue(resolved, 'q') ?? '').trim();

  // No term at all is a normal first visit, not an error.
  if (rawTerm.length === 0) {
    return (
      <PageShell title={tPage('heading')}>
        <EmptyState title={t('noQueryTitle')} description={t('noQueryDescription')} />
      </PageShell>
    );
  }

  // Too short is stated plainly rather than silently returning nothing, so the
  // customer knows why they see no results.
  if (rawTerm.length < MIN_SEARCH_TERM_LENGTH) {
    return (
      <PageShell title={tPage('heading')}>
        <EmptyState
          title={t('noQueryTitle')}
          description={t('termTooShort', { count: MIN_SEARCH_TERM_LENGTH })}
        />
      </PageShell>
    );
  }

  const candidate = {
    q: rawTerm,
    ...(firstValue(resolved, 'sort') ? { sort: firstValue(resolved, 'sort') } : {}),
    ...(firstValue(resolved, 'inStock') ? { inStock: firstValue(resolved, 'inStock') } : {}),
    ...(firstValue(resolved, 'page') ? { page: firstValue(resolved, 'page') } : {}),
    ...(firstValue(resolved, 'category') ? { category: firstValue(resolved, 'category') } : {}),
    // Honoured rather than dropped: it is a documented, validated parameter, and
    // silently ignoring it makes paged URLs behave differently from the API.
    ...(firstValue(resolved, 'limit') ? { limit: firstValue(resolved, 'limit') } : {}),
  };

  const parsed = searchQuerySchema.safeParse(candidate);

  // An invalid sort or page falls back to defaults rather than 422-ing a page a
  // customer reached from a link.
  const query = parsed.success ? parsed.data : { q: rawTerm };

  let results;
  try {
    const service = await getSearchService();
    results = await service.search(query, locale);
  } catch (error) {
    logger.exception(error);
    return (
      <PageShell title={tPage('heading')}>
        <ErrorState title={t('unavailableTitle')} description={t('unavailableDescription')} />
      </PageShell>
    );
  }

  const basePath = '/search';
  const sortOptions = buildSortOptions(
    basePath,
    resolved,
    [
      { value: DEFAULT_SORT, label: t('sortRelevance') },
      { value: 'pricePaise:asc', label: tCatalog('sortPriceAsc') },
      { value: 'pricePaise:desc', label: tCatalog('sortPriceDesc') },
      { value: 'createdAt:desc', label: tCatalog('sortNewest') },
    ],
    DEFAULT_SORT
  );

  const inStockOnly = firstValue(resolved, 'inStock') === 'true';
  const hasFilters = inStockOnly || Boolean(firstValue(resolved, 'category'));

  const labels = {
    outOfStock: tCatalog('outOfStock'),
    discountBadgeTemplate: tCatalog.raw('discountBadge') as string,
    mrpLabel: tCatalog('mrpLabel'),
    imagePlaceholder: tCatalog('imagePlaceholder'),
  };

  return (
    <PageShell title={t('resultsFor', { term: results.term })}>
      <div className="flex flex-col gap-6">
        {/* Category matches first: they lead somewhere broader than one product. */}
        {results.categories.length > 0 && (
          <section aria-labelledby="matching-categories">
            <h2 id="matching-categories" className="mb-3 text-sm font-semibold">
              {t('matchingCategories')}
            </h2>
            <CategoryGrid
              categories={results.categories.map((category) => ({
                slug: category.slug,
                name: category.name,
                imageKey: null,
                iconKey: null,
              }))}
              placeholderLabel={tCatalog('imagePlaceholder')}
            />
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">{tCatalog('sortLabel')}:</span>
          {sortOptions.map((option) => (
            <Link
              key={option.value}
              href={option.href}
              aria-current={option.isActive ? 'true' : undefined}
              data-testid="search-sort-option"
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
            href={buildCatalogHref(basePath, resolved, {
              inStock: inStockOnly ? null : 'true',
              // Any filter change resets to the first page; keeping the old page
              // number would land the customer on an empty page.
              page: null,
            })}
            aria-pressed={inStockOnly}
            data-testid="search-filter-instock"
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

        <p className="text-muted-foreground text-sm" data-testid="search-count">
          {t('resultCount', { count: results.total })}
        </p>

        {results.products.length === 0 ? (
          <EmptyState
            title={
              hasFilters ? t('noFilteredResultsTitle') : t('noResultsTitle', { term: results.term })
            }
            description={hasFilters ? t('noFilteredResultsDescription') : t('noResultsDescription')}
          />
        ) : (
          <ProductGrid products={results.products} locale={locale} labels={labels} />
        )}

        {/* Offset paging, because relevance has no stable keyset column. */}
        {(results.page > 1 || results.hasMore) && (
          <nav aria-label={t('page', { number: results.page })} className="flex items-center gap-3">
            {results.page > 1 && (
              <Link
                href={buildCatalogHref(basePath, resolved, {
                  page: results.page - 1 === 1 ? null : String(results.page - 1),
                })}
                data-testid="search-prev-page"
                className="border-border hover:bg-muted rounded-[var(--radius-control)] border px-4 py-2 text-sm"
              >
                {t('previous')}
              </Link>
            )}

            <span className="text-muted-foreground text-sm">
              {t('page', { number: results.page })}
            </span>

            {results.hasMore && (
              <Link
                href={buildCatalogHref(basePath, resolved, { page: String(results.page + 1) })}
                data-testid="search-next-page"
                className="border-border hover:bg-muted rounded-[var(--radius-control)] border px-4 py-2 text-sm"
              >
                {t('next')}
              </Link>
            )}
          </nav>
        )}
      </div>
    </PageShell>
  );
}
