import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { OrderStatusBadge } from '@/components/orders/order-status-badge';
import { VendorOrderDetailActions } from '@/components/vendor/order-detail-actions';
import { OrderTimeline } from '@/components/orders/order-timeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { checkVendorPage } from '@/lib/auth/vendor-page';
import { NotFoundError } from '@/lib/errors';
import { formatPaise, paise } from '@/lib/money';
import { getOrderService } from '@/modules/order';

/**
 * Vendor order detail (docs/ROUTES.md §6).
 *
 * Privacy boundary: this screen deliberately never renders the customer's phone number or
 * delivery address. The vendor only needs the order snapshots, totals, first name, note and
 * operational timeline; delivery PII belongs to the assigned driver, not the shop counter.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });

  return { title: t('orderDetail'), robots: { index: false, follow: false } };
}

export default async function VendorOrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const access = await checkVendorPage('order:view');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;

  const service = await getOrderService();
  const detail = await service.getForVendor(access.vendorId, id).catch((error: unknown) => {
    // A missing order and another vendor's order are intentionally indistinguishable.
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const manageAccess = await checkVendorPage('order:update_status');
  const canManage = manageAccess.status === 'ok';

  const tOrders = await getTranslations('orders');
  const tVendor = await getTranslations('vendorOrders');
  const money = (value: number) => formatPaise(paise(value), locale);
  const customerFirstName = detail.order.contactName.split(' ')[0] ?? '';

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4" data-testid="vendor-order-detail">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {tOrders('detail.title', { number: detail.order.orderNumber })}
          </h1>
          {customerFirstName && (
            <p className="text-muted-foreground mt-1 text-sm">{customerFirstName}</p>
          )}
        </div>
        <OrderStatusBadge status={detail.order.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tOrders('detail.items')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="flex flex-col gap-3">
                {detail.lines.map((line) => (
                  <li key={line.id} className="flex items-start justify-between gap-4 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{line.productNameSnapshot}</p>
                      <p className="text-muted-foreground text-xs">
                        {[line.variantLabelSnapshot, line.unitLabelSnapshot]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {tOrders('detail.lineQuantity', {
                          quantity: line.quantity,
                          price: money(line.unitPricePaise),
                        })}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium">{money(line.lineTotalPaise)}</span>
                  </li>
                ))}
              </ul>

              <div className="border-border flex items-center justify-between border-t pt-3 font-semibold">
                <span>{tOrders('summary.total')}</span>
                <span data-testid="vendor-order-total">{money(detail.order.totalAmountPaise)}</span>
              </div>

              {detail.order.isCod && (
                <p className="text-muted-foreground text-sm">
                  {tVendor('cod')} ·{' '}
                  {money(detail.order.codAmountPaise ?? detail.order.totalAmountPaise)}
                </p>
              )}
            </CardContent>
          </Card>

          <OrderTimeline events={detail.timeline} />
        </div>

        <aside className="flex flex-col gap-4">
          {canManage ? (
            <VendorOrderDetailActions orderId={detail.order.id} status={detail.order.status} />
          ) : null}
          <Card>
            <CardContent className="flex flex-col gap-2 p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{tOrders('detail.paymentLabel')}</span>
                <span>{tOrders(`detail.paymentMethod.${detail.order.paymentMethod}`)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {tOrders('detail.paymentStatusLabel')}
                </span>
                <span>{detail.order.paymentStatus}</span>
              </div>
            </CardContent>
          </Card>

          {detail.order.customerNote && (
            <Card>
              <CardContent className="p-4 text-sm">
                {tOrders('detail.note', { note: detail.order.customerNote })}
              </CardContent>
            </Card>
          )}

          <Button asChild variant="secondary">
            <Link href="/vendor/orders">{tOrders('detail.backToOrders')}</Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}
