import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminOrders } from '@/modules/admin-orders';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });

  return { title: t('orders'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('order:list');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [orders, t, format] = await Promise.all([
    listAdminOrders(),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-orders">
      <div>
        <h1 className="text-xl font-semibold">{t('orders')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'नवीनतम ऑर्डर, भुगतान स्थिति, विक्रेता और स्टोर की ऑपरेशनल सूची।'
            : 'Operational list of recent orders, payment state, vendor and store.'}
        </p>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'अभी कोई ऑर्डर नहीं है।' : 'No orders yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'ऑर्डर' : 'Order'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'स्टोर' : 'Store'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'स्थिति' : 'Status'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'भुगतान' : 'Payment'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'कुल' : 'Total'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'समय' : 'Created'}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link href={`/admin/orders/${order.id}`} className="font-medium hover:underline">
                        {order.orderNumber}
                      </Link>
                      <p className="text-muted-foreground mt-1 text-xs">{order.vendorName}</p>
                    </td>
                    <td className="px-4 py-3">{order.storeName}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(order.status)}>{order.status.replaceAll('_', ' ')}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <p>{order.paymentMethod}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {order.paymentStatus.replaceAll('_', ' ')}
                        {order.isCod ? ' · COD' : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {format.number(order.totalAmountPaise / 100, {
                        style: 'currency',
                        currency: 'INR',
                      })}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
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
        </div>
      )}
    </div>
  );
}

function statusVariant(status: string): BadgeVariant {
  if (status === 'DELIVERED') return 'success';
  if (status === 'CANCELLED' || status === 'FAILED') return 'danger';
  if (status === 'PENDING_PAYMENT') return 'warning';
  return 'primary';
}
