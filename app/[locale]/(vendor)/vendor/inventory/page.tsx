import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkVendorPage } from '@/lib/auth/vendor-page';
import { listVendorInventory } from '@/modules/vendor-inventory';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });
  return { title: t('inventory'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkVendorPage('inventory:view');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;

  const [items, t, format] = await Promise.all([
    listVendorInventory(access.vendorId),
    getTranslations('vendorNav'),
    getFormatter(),
  ]);

  const tracked = items.filter((item) => item.trackInventory);
  const lowStock = tracked.filter((item) => item.quantityAvailable <= item.lowStockThreshold);
  const outOfStock = tracked.filter((item) => item.quantityAvailable === 0);
  const reserved = items.reduce((sum, item) => sum + item.quantityReserved, 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="vendor-inventory">
      <div>
        <h1 className="text-xl font-semibold">{t('inventory')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'उपलब्ध, आरक्षित और कम स्टॉक वाली इन्वेंट्री एक जगह देखें।'
            : 'Monitor available, reserved, and low-stock inventory in one place.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label={locale === 'hi' ? 'SKU' : 'SKUs'} value={items.length} />
        <Metric label={locale === 'hi' ? 'कम स्टॉक' : 'Low stock'} value={lowStock.length} />
        <Metric label={locale === 'hi' ? 'स्टॉक खत्म' : 'Out of stock'} value={outOfStock.length} />
        <Metric label={locale === 'hi' ? 'आरक्षित यूनिट' : 'Reserved units'} value={reserved} />
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'अभी कोई इन्वेंट्री रिकॉर्ड नहीं है।' : 'No inventory records yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">
                    {locale === 'hi' ? 'प्रोडक्ट' : 'Product'}
                  </th>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'स्टोर' : 'Store'}</th>
                  <th className="px-4 py-3 font-medium">
                    {locale === 'hi' ? 'उपलब्ध' : 'Available'}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {locale === 'hi' ? 'आरक्षित' : 'Reserved'}
                  </th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'स्थिति' : 'Status'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'अपडेट' : 'Updated'}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => {
                  const isLow =
                    item.trackInventory && item.quantityAvailable <= item.lowStockThreshold;
                  return (
                    <tr key={item.inventoryId}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{item.productName}</p>
                        <p className="text-muted-foreground text-xs">
                          {item.unitLabel ?? item.productSlug} · {item.productStatus}
                        </p>
                      </td>
                      <td className="px-4 py-3">{item.sku ?? '—'}</td>
                      <td className="px-4 py-3">{item.storeName}</td>
                      <td className="px-4 py-3 font-medium">{item.quantityAvailable}</td>
                      <td className="px-4 py-3">{item.quantityReserved}</td>
                      <td className="px-4 py-3">
                        {!item.trackInventory ? (
                          <Badge variant="neutral">UNTRACKED</Badge>
                        ) : item.quantityAvailable === 0 ? (
                          <Badge variant="danger">OUT</Badge>
                        ) : isLow ? (
                          <Badge variant="warning">LOW</Badge>
                        ) : (
                          <Badge variant="success">OK</Badge>
                        )}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-xs">
                        {format.dateTime(item.updatedAt, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </td>
                    </tr>
                  );
                })}
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
