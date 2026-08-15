import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { defaultLocale, isLocale } from '@/i18n/routing';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { JsonLd } from '@/components/seo/json-ld';
import { OfferCard } from '@/components/marketing/offer-card';
import { breadcrumbJsonLd } from '@/lib/seo/json-ld';
import { canonicalUrl, publicPageMetadata, siteName } from '@/lib/seo/metadata';
import { logger } from '@/lib/logger';
import { readCartPincode } from '@/lib/shell/current-cart';
import { getCouponService } from '@/modules/coupons';
import { getLocationService } from '@/modules/location';
import type { OfferSummary } from '@/modules/coupons';

/**
 * Offers (docs/ROUTES.md §4, master spec §18).
 *
 * Server-rendered so every coupon is crawlable and readable without JavaScript.
 * Zone-aware: a coupon restricted to zones the customer cannot order from is not
 * advertised to them, because an offer you cannot use is worse than no offer.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.offers' });

  const resolved = isLocale(locale) ? locale : defaultLocale;

  return publicPageMetadata({
    title: t('title'),
    description: t('heading'),
    path: '/offers',
    locale: resolved,
    siteName: await siteName(resolved),
  });
}

export default async function OffersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('pages.offers');
  const tCatalog = await getTranslations('catalog');
  const tOffers = await getTranslations('offers');

  let offers: OfferSummary[];
  try {
    const [pincode, coupons] = await Promise.all([readCartPincode(), getCouponService()]);

    let zoneId: string | null = null;
    if (pincode) {
      const location = await getLocationService();
      zoneId = (await location.checkServiceability(pincode)).zone?.id ?? null;
    }

    offers = await coupons.listOffers(locale, zoneId);
  } catch (error) {
    // A marketing outage must degrade to a stated error, not a blank page.
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
    copy: tOffers('copyCode'),
    copied: tOffers('copied'),
    minCart: (amount: string) => tOffers('minCart', { amount }),
    upTo: (amount: string) => tOffers('maxDiscount', { amount }),
    firstOrderOnly: tOffers('firstOrderOnly'),
    expires: (date: string) => tOffers('expires', { date }),
  };

  return (
    <PageShell title={t('heading')}>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: tCatalog('breadcrumbHome'), url: canonicalUrl('/', locale) },
          { name: t('heading') },
        ])}
      />

      {offers.length === 0 ? (
        <EmptyState title={tOffers('emptyTitle')} description={tOffers('emptyDescription')} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{tOffers('applyHint')}</p>

          <ul className="grid gap-4 sm:grid-cols-2">
            {offers.map((offer) => (
              <li key={offer.id}>
                <OfferCard offer={offer} locale={locale} labels={labels} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageShell>
  );
}
