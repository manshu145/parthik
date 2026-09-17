import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { getOrderService } from '@/modules/order';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('orderDetail'), robots: { index: false, follow: false } };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('order:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [detail, t, format] = await Promise.all([
    getOrderService().then((service) => service.getForOperations(id)),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  const address = detail.order.deliveryAddressSnapshot as Record<string, unknown>;
  const addressText = [
    address.line1,
    address.line2,
    address.landmark,
    address.city,
    address.state,
    address.pincode,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(', ');

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4" data-testid="admin-order-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{detail.order.orderNumber}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('orderDetail')}</p>
        </div>
        <Badge variant={statusVariant(detail.order.status)}>
          {detail.order.status.replaceAll('_', ' ')}
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="p-4 text-sm">
            <h2 className="font-semibold">{locale === 'hi' ? 'ग्राहक' : 'Customer'}</h2>
            <p className="mt-2 font-medium">{detail.order.contactName}</p>
            <p className="text-muted-foreground mt-1">{detail.order.contactPhone}</p>
            {addressText && <p className="text-muted-foreground mt-2">{addressText}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 text-sm">
            <h2 className="font-semibold">{locale === 'hi' ? 'भुगतान' : 'Payment'}</h2>
            <div className="mt-2 flex flex-col gap-1">
              <p>
                {detail.order.paymentMethod}
                {detail.order.isCod ? ' · COD' : ''}
              </p>
              <p className="text-muted-foreground">
                {detail.order.paymentStatus.replaceAll('_', ' ')}
              </p>
              <p className="mt-2 text-lg font-semibold">
                {format.number(detail.order.totalAmountPaise / 100, {
                  style: 'currency',
                  currency: 'INR',
                })}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold">{locale === 'hi' ? 'आइटम' : 'Items'}</h2>
          <ul className="mt-3 divide-y">
            {detail.lines.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{line.productNameSnapshot}</p>
                  {line.variantLabelSnapshot && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {line.variantLabelSnapshot}
                    </p>
                  )}
                  <p className="text-muted-foreground mt-1 text-xs">Qty {line.quantity}</p>
                </div>
                <p className="font-medium">
                  {format.number(line.lineTotalPaise / 100, { style: 'currency', currency: 'INR' })}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold">{locale === 'hi' ? 'टाइमलाइन' : 'Timeline'}</h2>
          <ol className="mt-3 flex flex-col gap-3">
            {detail.timeline.map((event) => (
              <li key={event.id} className="border-l pl-3 text-sm">
                <p className="font-medium">{event.toStatus.replaceAll('_', ' ')}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {format.dateTime(event.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  {event.changedByRole ? ` · ${event.changedByRole}` : ''}
                </p>
                {event.reason && (
                  <p className="text-muted-foreground mt-1 text-xs">{event.reason}</p>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function statusVariant(status: string): BadgeVariant {
  if (status === 'DELIVERED') return 'success';
  if (status === 'CANCELLED' || status === 'FAILED') return 'danger';
  if (status === 'PENDING_PAYMENT') return 'warning';
  return 'primary';
}
