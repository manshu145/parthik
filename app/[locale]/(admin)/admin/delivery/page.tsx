import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminDeliveries } from '@/modules/admin-delivery';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('deliveryBoard'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('delivery:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [deliveries, t, format] = await Promise.all([
    listAdminDeliveries(),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  const waiting = deliveries.filter((delivery) => delivery.status === 'PENDING_ASSIGNMENT').length;
  const active = deliveries.filter((delivery) =>
    [
      'OFFERED',
      'ASSIGNED',
      'EN_ROUTE_TO_STORE',
      'AT_STORE',
      'PICKED_UP',
      'EN_ROUTE_TO_CUSTOMER',
      'AT_CUSTOMER',
    ].includes(delivery.status)
  ).length;
  const failed = deliveries.filter((delivery) => delivery.status === 'FAILED').length;
  const codVariance = deliveries.reduce(
    (total, delivery) => total + Math.abs(delivery.codVariancePaise ?? 0),
    0
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-delivery-board">
      <div>
        <h1 className="text-xl font-semibold">{t('deliveryBoard')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Dispatch, active deliveries, driver assignment और COD variance की live स्थिति।'
            : 'Live dispatch, active delivery, driver assignment and COD variance status.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label={locale === 'hi' ? 'असाइनमेंट लंबित' : 'Awaiting assignment'} value={waiting} />
        <Metric label={locale === 'hi' ? 'सक्रिय डिलीवरी' : 'Active deliveries'} value={active} />
        <Metric label={locale === 'hi' ? 'असफल' : 'Failed'} value={failed} />
        <Metric
          label={locale === 'hi' ? 'COD variance' : 'COD variance'}
          value={format.number(codVariance / 100, { style: 'currency', currency: 'INR' })}
        />
      </div>

      {deliveries.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'अभी कोई delivery record नहीं है।' : 'No delivery records yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Store</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Driver</th>
                  <th className="px-4 py-3 font-medium">Distance</th>
                  <th className="px-4 py-3 font-medium">COD</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {deliveries.map((delivery) => (
                  <tr key={delivery.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium">{delivery.orderNumber}</p>
                      <p className="text-muted-foreground mt-1 text-xs">{delivery.vendorName}</p>
                    </td>
                    <td className="px-4 py-3">{delivery.storeName}</td>
                    <td className="px-4 py-3">
                      <Badge variant={deliveryStatusVariant(delivery.status)}>
                        {delivery.status.replaceAll('_', ' ')}
                      </Badge>
                      {delivery.failureReason ? (
                        <p className="text-danger mt-1 max-w-56 text-xs">{delivery.failureReason}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {delivery.driverName ? (
                        <>
                          <p>{delivery.driverName}</p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {delivery.driverCode ?? '—'}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {delivery.distanceKm ? `${delivery.distanceKm} km` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {delivery.codExpectedPaise === null ? (
                        <span className="text-muted-foreground">Prepaid</span>
                      ) : (
                        <>
                          <p>
                            {format.number(delivery.codExpectedPaise / 100, {
                              style: 'currency',
                              currency: 'INR',
                            })}
                          </p>
                          {delivery.codVariancePaise ? (
                            <p className="text-danger mt-1 text-xs">
                              variance{' '}
                              {format.number(delivery.codVariancePaise / 100, {
                                style: 'currency',
                                currency: 'INR',
                              })}
                            </p>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {format.dateTime(delivery.createdAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
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

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-muted-foreground mt-1 text-xs">{label}</p>
      </CardContent>
    </Card>
  );
}

function deliveryStatusVariant(status: string): BadgeVariant {
  if (status === 'DELIVERED') return 'success';
  if (status === 'FAILED' || status === 'CANCELLED') return 'danger';
  if (status === 'PENDING_ASSIGNMENT' || status === 'OFFERED') return 'warning';
  return 'neutral';
}
