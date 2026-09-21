import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { ProductImport } from '@/components/vendor/product-import';
import { checkVendorPage } from '@/lib/auth/vendor-page';
import { listVendorProductFormOptions } from '@/modules/vendor-products';

export const dynamic = 'force-dynamic';

/**
 * Route is live, screen is pending. See components/layout/dashboard-page.tsx for
 * why a shared placeholder is the honest choice here.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });

  // Every dashboard route is noindex (docs/ROUTES.md §6–§8).
  return { title: t('productImport'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('vendorNav');
  const access = await checkVendorPage('product:manage');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;
  const options = await listVendorProductFormOptions(access.vendorId);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4"><h1 className="text-xl font-semibold">{t('productImport')}</h1><ProductImport stores={options.stores} categories={options.categories} /></div>
  );
}
