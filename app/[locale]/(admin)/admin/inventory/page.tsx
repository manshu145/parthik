import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { InventoryAdjustment } from '@/components/admin/inventory-adjustment';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { currentActorCan } from '@/lib/auth/current-actor';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminInventory } from '@/modules/admin-catalog';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('inventory'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('inventory:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t, format, canManage] = await Promise.all([
    listAdminInventory(),
    getTranslations('adminNav'),
    getFormatter(),
    currentActorCan('inventory:manage'),
  ]);

  const lowStock = rows.filter(
    (row) => row.trackInventory && row.quantityAvailable <= row.lowStockThreshold
  ).length;
  const outOfStock = rows.filter((row) => row.trackInventory && row.quantityAvailable === 0).length;
  const reservedUnits = rows.reduce((total, row) => total + row.quantityReserved, 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-inventory">
      <div>
        <h1 className="text-xl font-semibold">{t('inventory')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'सभी stores का stock, reservation और low-stock risk.'
            : 'Stock, reservations and low-stock risk across every store.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label={locale === 'hi' ? 'कम स्टॉक' : 'Low stock'} value={lowStock} />
        <Metric label={locale === 'hi' ? 'स्टॉक खत्म' : 'Out of stock'} value={outOfStock} />
        <Metric
          label={locale === 'hi' ? 'आरक्षित units' : 'Reserved units'}
          value={reservedUnits}
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'अभी inventory rows नहीं हैं।' : 'No inventory rows yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Vendor / Store</th>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">Available</th>
                  <th className="px-4 py-3 font-medium">Reserved</th>
                  <th className="px-4 py-3 font-medium">Threshold</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  {canManage ? <th className="px-4 py-3 font-medium">Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => {
                  const isLow =
                    row.trackInventory && row.quantityAvailable <= row.lowStockThreshold;
                  return (
                    <tr key={row.inventoryId} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.productName}</p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {row.productStatus}
                          {row.unitLabel ? ` · ${row.unitLabel}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{row.vendorName}</p>
                        <p className="text-muted-foreground mt-1 text-xs">{row.storeName}</p>
                      </td>
                      <td className="px-4 py-3">{row.sku ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{row.quantityAvailable}</span>
                          {isLow && (
                            <Badge variant={row.quantityAvailable === 0 ? 'danger' : 'warning'}>
                              {row.quantityAvailable === 0 ? 'OUT' : 'LOW'}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{row.quantityReserved}</td>
                      <td className="px-4 py-3">
                        {row.lowStockThreshold}
                        {row.allowBackorder ? (
                          <p className="text-muted-foreground mt-1 text-xs">Backorder</p>
                        ) : null}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-xs">
                        {format.dateTime(row.updatedAt, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </td>
                      {canManage ? (
                        <td className="px-4 py-3">
                          <InventoryAdjustment inventoryId={row.inventoryId} />
                        </td>
                      ) : null}
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
