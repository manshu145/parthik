import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { CategoryGrid } from '@/components/catalog/category-card';
import { ProductGrid } from '@/components/catalog/product-grid';
import { HomeBannerGrid } from '@/components/marketing/home-banner';
import { OfferCard } from '@/components/marketing/offer-card';
import { Link } from '@/i18n/navigation';
import { defaultLocale, isLocale } from '@/i18n/routing';
import { JsonLd } from '@/components/seo/json-ld';
import { organizationJsonLd, websiteJsonLd } from '@/lib/seo/json-ld';
import { publicPageMetadata } from '@/lib/seo/metadata';
import { logger } from '@/lib/logger';
import { getCurrentActor } from '@/lib/auth/current-actor';
import { readCartPincode } from '@/lib/shell/current-cart';
import { getCatalogService } from '@/modules/catalog';
import { getCouponService } from '@/modules/coupons';
import {
  getActiveHomepageSections,
  listHomepageBanners,
  resolveHomepageAudience,
} from '@/modules/homepage';
import { getLocationService } from '@/modules/location';

export const dynamic = 'force-dynamic';

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
  const tOffers = await getTranslations('offers');
  const tOffersPage = await getTranslations('pages.offers');

  try {
    const [pincode, actor, catalog] = await Promise.all([
      readCartPincode(),
      getCurrentActor(),
      getCatalogService(),
    ]);

    let zoneId: string | null = null;
    if (pincode) {
      const location = await getLocationService();
      zoneId = (await location.checkServiceability(pincode)).zone?.id ?? null;
    }

    const audience = await resolveHomepageAudience(actor?.userId ?? null);
    const sections = (await getActiveHomepageSections(zoneId)).filter(
      (section) => section.visible
    );

    const categoryLimit = maxSectionLimit(sections, 'FEATURED_CATEGORIES', 6);
    const popularLimit = maxSectionLimit(sections, 'POPULAR_PRODUCTS', 10);
    const offerLimit = maxSectionLimit(sections, 'COUPON_STRIP', 4);
    const needsBanners = sections.some((section) => section.type === 'HERO_BANNERS');

    const [categories, popular, banners, offers] = await Promise.all([
      categoryLimit > 0 ? catalog.getFeaturedCategories(locale, categoryLimit) : Promise.resolve([]),
      popularLimit > 0 ? catalog.getPopularProducts(locale, popularLimit) : Promise.resolve([]),
      needsBanners
        ? listHomepageBanners({ locale, deliveryZoneId: zoneId, audience })
        : Promise.resolve([]),
      offerLimit > 0
        ? getCouponService().then((coupons) => coupons.listOffers(locale, zoneId))
        : Promise.resolve([]),
    ]);

    const labels = {
      outOfStock: tCatalog('outOfStock'),
      discountBadgeTemplate: tCatalog.raw('discountBadge') as string,
      mrpLabel: tCatalog('mrpLabel'),
      imagePlaceholder: tCatalog('imagePlaceholder'),
    };
    const offerLabels = {
      copy: tOffers('copyCode'),
      copied: tOffers('copied'),
      minCart: (amount: string) => tOffers('minCart', { amount }),
      upTo: (amount: string) => tOffers('maxDiscount', { amount }),
      firstOrderOnly: tOffers('firstOrderOnly'),
      expires: (date: string) => tOffers('expires', { date }),
    };

    const renderedAny = sections.some((section) => {
      if (section.type === 'HERO_BANNERS') {
        const placement = section.config.placement ?? 'HOME_HERO';
        return banners.some((banner) => banner.placement === placement);
      }
      if (section.type === 'FEATURED_CATEGORIES') return categories.length > 0;
      if (section.type === 'POPULAR_PRODUCTS') return popular.length > 0;
      return offers.length > 0;
    });

    return (
      <PageShell title={t('heading')}>
        <JsonLd
          data={organizationJsonLd({
            name: tCommon('appName'),
            description: tCommon('tagline'),
            locale,
          })}
        />
        <JsonLd data={websiteJsonLd({ name: tCommon('appName'), locale })} />

        <div className="flex flex-col gap-8">
          {!renderedAny ? (
            <EmptyState
              title={tCatalog('emptyCategoryTitle')}
              description={tCatalog('emptyCategoryDescription')}
            />
          ) : null}

          {sections.map((section, index) => {
            const titleId = 'home-section-' + index;

            if (section.type === 'HERO_BANNERS') {
              const placement = section.config.placement ?? 'HOME_HERO';
              const sectionBanners = banners
                .filter((banner) => banner.placement === placement)
                .slice(0, section.config.limit ?? 4);
              if (sectionBanners.length === 0) return null;

              return (
                <section key={titleId} aria-label={section.title ?? 'Highlights'}>
                  {section.title ? (
                    <h2 className="mb-3 text-base font-semibold">{section.title}</h2>
                  ) : null}
                  <HomeBannerGrid banners={sectionBanners} locale={locale} />
                </section>
              );
            }

            if (section.type === 'FEATURED_CATEGORIES') {
              const items = categories.slice(0, section.config.limit ?? 6);
              if (items.length === 0) return null;

              return (
                <section key={titleId} aria-labelledby={titleId}>
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <h2 id={titleId} className="text-base font-semibold">
                      {section.title ?? tCatalog('featuredCategories')}
                    </h2>
                    <Link
                      href="/categories"
                      className="text-primary text-sm underline-offset-2 hover:underline"
                    >
                      {tCatalog('viewAll')}
                    </Link>
                  </div>
                  <CategoryGrid
                    categories={items}
                    placeholderLabel={tCatalog('imagePlaceholder')}
                  />
                </section>
              );
            }

            if (section.type === 'POPULAR_PRODUCTS') {
              const items = popular.slice(0, section.config.limit ?? 10);
              if (items.length === 0) return null;

              return (
                <section key={titleId} aria-labelledby={titleId}>
                  <h2 id={titleId} className="mb-3 text-base font-semibold">
                    {section.title ?? tCatalog('popularProducts')}
                  </h2>
                  <ProductGrid products={items} locale={locale} labels={labels} />
                </section>
              );
            }

            const items = offers.slice(0, section.config.limit ?? 4);
            if (items.length === 0) return null;

            return (
              <section key={titleId} aria-labelledby={titleId}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 id={titleId} className="text-base font-semibold">
                    {section.title ?? tOffersPage('heading')}
                  </h2>
                  <Link
                    href="/offers"
                    className="text-primary text-sm underline-offset-2 hover:underline"
                  >
                    {tCatalog('viewAll')}
                  </Link>
                </div>
                <ul className="grid gap-4 sm:grid-cols-2">
                  {items.map((offer) => (
                    <li key={offer.id}>
                      <OfferCard offer={offer} locale={locale} labels={offerLabels} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </PageShell>
    );
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
}

function maxSectionLimit(
  sections: Awaited<ReturnType<typeof getActiveHomepageSections>>,
  type: 'FEATURED_CATEGORIES' | 'POPULAR_PRODUCTS' | 'COUPON_STRIP',
  fallback: number
): number {
  const matching = sections.filter((section) => section.type === type);
  if (matching.length === 0) return 0;
  return Math.max(...matching.map((section) => section.config.limit ?? fallback));
}
