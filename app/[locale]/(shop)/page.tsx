import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { CategoryGrid } from '@/components/catalog/category-card';
import { ProductGrid } from '@/components/catalog/product-grid';
import { Link } from '@/i18n/navigation';
import { defaultLocale, isLocale } from '@/i18n/routing';
import { JsonLd } from '@/components/seo/json-ld';
import { organizationJsonLd, websiteJsonLd } from '@/lib/seo/json-ld';
import { publicPageMetadata } from '@/lib/seo/metadata';
import { logger } from '@/lib/logger';
import { getCatalogService } from '@/modules/catalog';

/**
 * Home.
 *
 * Renders real featured categories and popular products so the storefront is
 * browsable from the first screen.
 *
 * NOTE: the final homepage is CMS-driven — section order, banners and visibility
 * come from `home_layouts` (master spec §9, D-30), which arrives with the CMS task.
 * These two sections are the catalogue-owned content; they are not an attempt to
 * pre-empt that layout builder.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.home' });
  const tCommon = await getTranslations({ locale, namespace: 'common' });
  const resolved = isLocale(locale) ? locale : defaultLocale;

  return publicPageMetadata({
    title: t('title'),
    description: tCommon('tagline'),
    path: '/',
    locale: resolved,
    siteName: tCommon('appName'),
  });
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('pages.home');
  const tCatalog = await getTranslations('catalog');
  const tCommon = await getTranslations('common');

  let categories;
  let popular;
  try {
    const service = await getCatalogService();
    // Independent reads, so one slow query does not serialise the other.
    [categories, popular] = await Promise.all([
      service.getFeaturedCategories(locale),
      service.getPopularProducts(locale, 10),
    ]);
  } catch (error) {
    logger.exception(error);
    return (
      <PageShell title={t('heading')}>
        <ErrorState
          title={tCatalog('unavailableTitle')}
          description={tCatalog('unavailableDescription')}
        />
      </PageShell>
    );
  }

  const labels = {
    outOfStock: tCatalog('outOfStock'),
    discountBadgeTemplate: tCatalog.raw('discountBadge') as string,
    mrpLabel: tCatalog('mrpLabel'),
    imagePlaceholder: tCatalog('imagePlaceholder'),
  };

  const hasContent = categories.length > 0 || popular.length > 0;

  return (
    <PageShell title={t('heading')}>
      {/*
        Site-level structured data belongs on the home page only — repeating
        Organization on every page gives crawlers the same entity dozens of times.

        Organization and WebSite are emitted because every field is real. LocalBusiness
        is NOT: it requires a verifiable street address and postal code, and no public
        store read exposes one yet (that arrives with the vendor store profile). Asserting
        an address we cannot stand behind invites a manual action, so the node is omitted
        rather than filled with plausible values.
      */}
      <JsonLd
        data={organizationJsonLd({
          name: tCommon('appName'),
          description: tCommon('tagline'),
          locale,
        })}
      />
      <JsonLd data={websiteJsonLd({ name: tCommon('appName'), locale })} />

      <div className="flex flex-col gap-8">
        {!hasContent && (
          <EmptyState
            title={tCatalog('emptyCategoryTitle')}
            description={tCatalog('emptyCategoryDescription')}
          />
        )}

        {categories.length > 0 && (
          <section aria-labelledby="featured-categories">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="featured-categories" className="text-base font-semibold">
                {tCatalog('featuredCategories')}
              </h2>
              <Link
                href="/categories"
                className="text-primary text-sm underline-offset-2 hover:underline"
              >
                {tCatalog('viewAll')}
              </Link>
            </div>
            <CategoryGrid categories={categories} placeholderLabel={tCatalog('imagePlaceholder')} />
          </section>
        )}

        {popular.length > 0 && (
          <section aria-labelledby="popular-products">
            <h2 id="popular-products" className="mb-3 text-base font-semibold">
              {tCatalog('popularProducts')}
            </h2>
            <ProductGrid products={popular} locale={locale} labels={labels} />
          </section>
        )}
      </div>
    </PageShell>
  );
}
