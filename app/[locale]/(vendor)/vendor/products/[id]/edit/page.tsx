import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { VendorProductForm } from '@/components/vendor/product-form';
import { checkVendorPage } from '@/lib/auth/vendor-page';
import {
  listVendorProductFormOptions,
  readVendorProductForEdit,
} from '@/modules/vendor-products';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });
  return { title: t('productEdit'), robots: { index: false, follow: false } };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await checkVendorPage('product:manage');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;

  const [product, options, t] = await Promise.all([
    readVendorProductForEdit(access.vendorId, id),
    listVendorProductFormOptions(access.vendorId),
    getTranslations('vendorNav'),
  ]);

  if (!product) notFound();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4" data-testid="vendor-product-edit">
      <div>
        <h1 className="text-xl font-semibold">{t('productEdit')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? `${product.name} की catalog, pricing और stock जानकारी edit करें। Concurrent बदलाव होने पर stale save reject होगा।`
            : `Edit catalog, pricing and stock for ${product.name}. Stale saves are rejected if another update happened first.`}
        </p>
      </div>
      <VendorProductForm
        locale={locale}
        stores={options.stores}
        categories={options.categories}
        initial={product}
      />
    </div>
  );
}
