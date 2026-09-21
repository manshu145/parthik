import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkVendorPage } from '@/lib/auth/vendor-page';
import { formatPaise, paise } from '@/lib/money';
import { listVendorProducts } from '@/modules/vendor-products';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });
  return { title: t('products'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkVendorPage('product:list');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;

  const [items, t, format] = await Promise.all([
    listVendorProducts(access.vendorId),
    getTranslations('vendorNav'),
    getFormatter(),
  ]);

  const active = items.filter((item) => item.status === 'ACTIVE').length;
  const drafts = items.filter((item) => item.status === 'DRAFT').length;
  const pending = items.filter((item) => item.status === 'PENDING_APPROVAL').length;
  const moneyLocale = locale === 'hi' ? 'hi' : 'en';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="vendor-products">
      <div>
        <h1 className="text-xl font-semibold">{t('products')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'अपने कैटलॉग की स्थिति, कीमत और बिक्री एक जगह देखें।'
            : 'Review your catalogue status, pricing, and sales in one place.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label={locale === 'hi' ? 'कुल प्रोडक्ट' : 'Total products'} value={items.length} />
        <Metric label={locale === 'hi' ? 'सक्रिय' : 'Active'} value={active} />
        <Metric label={locale === 'hi' ? 'ड्राफ्ट' : 'Drafts'} value={drafts} />
        <Metric label={locale === 'hi' ? 'स्वीकृति लंबित' : 'Pending approval'} value={pending} />
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'अभी कोई प्रोडक्ट नहीं है।' : 'No products yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'प्रोडक्ट' : 'Product'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'स्टोर' : 'Store'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'कीमत' : 'Price'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'स्थिति' : 'Status'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'बिक्री' : 'Sold'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'अपडेट' : 'Updated'}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-muted-foreground text-xs">/{item.slug}</p>
                    </td>
                    <td className="px-4 py-3">{item.storeName}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{formatPaise(paise(item.pricePaise), moneyLocale)}</p>
                      {item.mrpPaise !== item.pricePaise && (
                        <p className="text-muted-foreground text-xs line-through">
                          {formatPaise(paise(item.mrpPaise), moneyLocale)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(item.status)}>{item.status.replaceAll('_', ' ')}</Badge>
                    </td>
                    <td className="px-4 py-3">{item.soldCount}</td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {format.dateTime(item.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-muted-foreground mt-1 text-xs">{label}</p>
      </CardContent>
    </Card>
  );
}

function statusVariant(status: string) {
  if (status === 'ACTIVE') return 'success' as const;
  if (status === 'REJECTED' || status === 'ARCHIVED') return 'danger' as const;
  if (status === 'PENDING_APPROVAL') return 'warning' as const;
  return 'neutral' as const;
}
