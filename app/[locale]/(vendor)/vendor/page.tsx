import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Card, CardContent } from '@/components/ui/card';
import { checkVendorPage } from '@/lib/auth/vendor-page';
import { readVendorAnalytics } from '@/modules/vendor-operations';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });
  return { title: t('overview'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkVendorPage('analytics:view');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;

  const [analytics, t, format] = await Promise.all([
    readVendorAnalytics(access.vendorId),
    getTranslations('vendorNav'),
    getFormatter(),
  ]);

  const deliveredGmv = format.number(Number(analytics.orders.deliveredGmvPaise) / 100, {
    style: 'currency',
    currency: 'INR',
  });
  const calculatedPayout = format.number(Number(analytics.orders.vendorPayoutPaise) / 100, {
    style: 'currency',
    currency: 'INR',
  });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="vendor-overview">
      <div>
        <h1 className="text-xl font-semibold">{t('overview')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'आज के vendor operations, orders, catalog और revenue का live overview।'
            : 'Live overview of vendor operations, orders, catalog and revenue.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total orders" value={analytics.orders.totalOrders} />
        <Metric label="Active orders" value={analytics.orders.activeOrders} />
        <Metric label="Delivered GMV" value={deliveredGmv} />
        <Metric label="Calculated payout" value={calculatedPayout} />
        <Metric label="Active products" value={analytics.products.activeProducts} />
        <Metric label="Pending review" value={analytics.products.pendingProducts} />
        <Metric label="Units sold" value={analytics.products.soldUnits} />
        <Metric label="Cancelled / failed" value={analytics.orders.cancelledOrders} />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{locale === 'hi' ? 'हाल के ऑर्डर' : 'Recent orders'}</h2>
            <span className="text-muted-foreground text-xs">Last 10</span>
          </div>
          {analytics.recentOrders.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">No orders yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr>
                    <th className="py-2 font-medium">Order</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Amount</th>
                    <th className="py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {analytics.recentOrders.map((order) => (
                    <tr key={order.id}>
                      <td className="py-3 font-medium">{order.orderNumber}</td>
                      <td className="py-3">{order.status.replaceAll('_', ' ')}</td>
                      <td className="py-3">
                        {format.number(order.totalAmountPaise / 100, {
                          style: 'currency',
                          currency: 'INR',
                        })}
                      </td>
                      <td className="text-muted-foreground py-3 text-xs">
                        {format.dateTime(order.createdAt, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        {locale === 'hi'
          ? 'Calculated payout reporting केवल visibility के लिए है; D-15 तय होने तक automated settlement disabled है।'
          : 'Calculated payout is reporting only; automated settlement remains disabled until D-15 is decided.'}
      </p>
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
