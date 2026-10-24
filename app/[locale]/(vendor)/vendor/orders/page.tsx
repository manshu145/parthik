import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VendorOrderQueue } from '@/components/vendor/order-queue';
import { AccessDenied } from '@/app/_components/access-denied';
import { checkVendorPage } from '@/lib/auth/vendor-page';

/**
 * The vendor's order queue — REAL SCREEN (docs/ROUTES.md §6).
 *
 * The page's whole server-side job is authorisation: `order:list` scoped to the vendor resolved
 * from the session. The queue itself is client-rendered and polled, because a shop counter leaves
 * it open all day and a new order has to appear without anyone reloading.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });

  // Every dashboard route is noindex (docs/ROUTES.md §6-§8).
  return { title: t('orders'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  /**
   * Enforced HERE, not in the component.
   *
   * `components/` cannot import modules by design, so a component could not authorise even if it
   * wanted to. The layout's surface guard already requires a VENDOR role; this adds the permission
   * and the tenant.
   */
  const access = await checkVendorPage('order:list');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const t = await getTranslations('vendorNav');

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('orders')}</h1>
      <VendorOrderQueue />
    </div>
  );
}
