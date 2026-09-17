import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { VendorProductForm } from '@/components/vendor/product-form';
import { checkVendorPage } from '@/lib/auth/vendor-page';
import { listVendorProductFormOptions } from '@/modules/vendor-products';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });
  return { title: t('productNew'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkVendorPage('product:manage');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;

  const [options, t] = await Promise.all([
    listVendorProductFormOptions(access.vendorId),
    getTranslations('vendorNav'),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4" data-testid="vendor-product-new">
      <div>
        <h1 className="text-xl font-semibold">{t('productNew')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'नया product draft के रूप में बनाएं। Price, default variant और opening stock एक transaction में save होंगे।'
            : 'Create a new draft product. Pricing, the default variant and opening stock are saved in one transaction.'}
        </p>
      </div>
      <VendorProductForm
        locale={locale}
        stores={options.stores}
        categories={options.categories}
      />
    </div>
  );
}
