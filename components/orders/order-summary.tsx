'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatPaise, paise } from '@/lib/money';
import { formatAddressSnapshot, type OrderLineView, type OrderSummaryView } from '@/lib/order/view';

/**
 * The order as placed — lines, totals, address and payment.
 *
 * Everything here is read from the order's own SNAPSHOTS, never re-derived from the
 * catalogue. A product renamed or repriced tomorrow must not change what this order says it
 * was, or a customer disputing a charge and support reading the same screen would see two
 * different orders (docs/DATABASE.md §6).
 *
 * 🔴 NOT A TAX INVOICE, and it does not pretend to be one. D-14 is unanswered, so there is no
 * tax row, no GSTIN, no HSN and no "invoice" heading — the notice at the bottom says so in
 * words (docs/ROUTES.md §14).
 */
export function OrderSummary({
  order,
  lines,
}: {
  order: OrderSummaryView;
  lines: OrderLineView[];
}) {
  const t = useTranslations('orders');
  const locale = useLocale() as 'en' | 'hi';
  const format = useFormatter();
  const money = (value: number) => formatPaise(paise(value), locale);

  const address = formatAddressSnapshot(order.deliveryAddressSnapshot);

  return (
    <div className="flex flex-col gap-4" data-testid="order-summary">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('detail.items')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col gap-3">
            {lines.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{line.productNameSnapshot}</p>
                  <p className="text-muted-foreground text-xs">
                    {[line.variantLabelSnapshot, line.unitLabelSnapshot]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t('detail.lineQuantity', {
                      quantity: line.quantity,
                      price: money(line.unitPricePaise),
                    })}
                  </p>
                </div>
                <span className="shrink-0 font-medium">{money(line.lineTotalPaise)}</span>
              </li>
            ))}
          </ul>

          <div className="border-border flex flex-col gap-2 border-t pt-3 text-sm">
            <Row label={t('summary.items')} value={money(order.grossAmountPaise)} />

            {order.itemDiscountPaise > 0 && (
              <Row
                label={t('summary.itemSavings')}
                value={`− ${money(order.itemDiscountPaise)}`}
                tone="positive"
              />
            )}

            {order.couponDiscountPaise > 0 && (
              <Row
                label={t('summary.coupon', { code: order.couponCodeSnapshot ?? '' })}
                value={`− ${money(order.couponDiscountPaise)}`}
                tone="positive"
              />
            )}

            <Row
              label={t('summary.delivery')}
              value={
                order.deliveryFeePaise === 0 ? t('summary.free') : money(order.deliveryFeePaise)
              }
              tone={order.deliveryFeePaise === 0 ? 'positive' : undefined}
            />

            {order.packagingFeePaise > 0 && (
              <Row label={t('summary.packaging')} value={money(order.packagingFeePaise)} />
            )}
            {order.serviceFeePaise > 0 && (
              <Row label={t('summary.service')} value={money(order.serviceFeePaise)} />
            )}

            {/*
              NO TAX ROW. Not even a zero one — "₹0 GST" is itself a claim about tax
              treatment, and D-14 has not made one (docs/ARCHITECTURE.md §11.2.2).
            */}

            <div className="border-border mt-1 flex items-center justify-between border-t pt-2 text-base font-semibold">
              <span>{t('summary.total')}</span>
              <span data-testid="order-detail-total">{money(order.totalAmountPaise)}</span>
            </div>

            {order.isCod && order.codAmountPaise !== null && (
              <p className="text-muted-foreground text-xs">
                {t('summary.codDue', { amount: money(order.codAmountPaise) })}
              </p>
            )}

            <p className="text-muted-foreground pt-1 text-xs" data-testid="order-no-invoice-notice">
              {t('detail.notAnInvoice')}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('detail.delivery')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="font-medium">{order.contactName}</p>
          <p className="text-muted-foreground">{order.contactPhone}</p>
          <p className="text-muted-foreground">{address}</p>

          {order.customerNote && (
            <p className="text-muted-foreground">
              {t('detail.note', { note: order.customerNote })}
            </p>
          )}

          <div className="border-border mt-2 flex flex-col gap-1 border-t pt-2">
            <Row
              label={t('detail.paymentLabel')}
              value={t(`detail.paymentMethod.${order.paymentMethod}`)}
            />
            <Row label={t('detail.paymentStatusLabel')} value={order.paymentStatus} />

            {order.placedAt && (
              <Row
                label={t('detail.placedLabel')}
                value={format.dateTime(new Date(order.placedAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              />
            )}

            {order.deliveredAt && (
              <Row
                label={t('detail.deliveredLabel')}
                value={format.dateTime(new Date(order.deliveredAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'positive' }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={tone === 'positive' ? 'text-success' : undefined}>{value}</span>
    </div>
  );
}
