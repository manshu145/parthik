import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Card, CardContent } from '@/components/ui/card';
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
  return { title: t('categories'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkVendorPage('product:view');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;

  const [options, t] = await Promise.all([
    listVendorProductFormOptions(access.vendorId),
    getTranslations('vendorNav'),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4" data-testid="vendor-categories">
      <div>
        <h1 className="text-xl font-semibold">{t('categories')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Products बनाते समय उपलब्ध active catalog categories। Category structure platform admin manage करता है।'
            : 'Active catalog categories available when creating products. Category structure is managed by platform admins.'}
        </p>
      </div>

      {options.categories.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            No active categories are currently available.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {options.categories.map((category) => (
            <Card key={category.id}>
              <CardContent className="p-4">
                <p className="font-medium">{category.name}</p>
                <p className="text-muted-foreground mt-1 truncate text-xs">{category.id}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
