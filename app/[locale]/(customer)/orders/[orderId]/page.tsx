import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { PageShell } from '@/components/layout/page-shell';
import { CancelOrderButton } from '@/components/orders/cancel-order-button';
import { OrderStatusBadge } from '@/components/orders/order-status-badge';
import { OrderSummary } from '@/components/orders/order-summary';
import { OrderTimeline } from '@/components/orders/order-timeline';
import { ReorderButton } from '@/components/orders/reorder-button';
import { Button } from '@/components/ui/button';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { NotFoundError } from '@/lib/errors';
import { getOrderService } from '@/modules/order';

/**
 * One order (docs/ROUTES.md §5).
 *
 * Ownership is enforced in the repository's WHERE clause, so another customer's order id
 * resolves to null and this renders a 404 — deliberately indistinguishable from an id that
 * never existed. A 403 would confirm the order exists, which is itself a leak.
 *
 * 🔴 NOT AN INVOICE ROUTE. D-14 is blocked, so this is an order summary and says so in words
 * (docs/ROUTES.md §14).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'orders' });

  return { title: t('detail.metaTitle'), robots: { index: false, follow: false } };
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; orderId: string }>;
}) {
  const { locale, orderId } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('orders');
  const actor = await requireCurrentActor();
  const service = await getOrderService();

  const detail = await service.getForUser(actor.userId, orderId).catch((error: unknown) => {
    // The service throws NotFoundError for both "no such order" and "not yours". Anything
    // else is a real fault and must not be swallowed into a 404.
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const isActive = service.isActive(detail.order.status);
  const canCancel = service.canCustomerCancel(detail.order);

  return (
    <PageShell
      title={t('detail.title', { number: detail.order.orderNumber })}
      headerAction={<OrderStatusBadge status={detail.order.status} />}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]" data-testid="order-detail">
        <div className="flex flex-col gap-4">
          <OrderSummary order={detail.order} lines={detail.lines} />
          <OrderTimeline events={detail.timeline} />
        </div>

        <aside className="flex flex-col gap-3">
          {/* Live tracking only while the order can still move. A "track" button on a
              delivered order leads to a page that will never change. */}
          {isActive && (
            <Button asChild>
              <Link href={`/orders/${detail.order.id}/track`}>{t('detail.track')}</Link>
            </Button>
          )}

          <ReorderButton
            lines={detail.lines.map((line) => ({
              variantId: line.variantId,
              quantity: line.quantity,
            }))}
          />

          {/* Rendered from the SERVER's decision, not from a status check in the browser: the
              cancellation policy is the thing that decides, and it lives on the server. */}
          {canCancel && <CancelOrderButton orderId={detail.order.id} />}

          {detail.order.cancellationReason && (
            <p className="text-muted-foreground text-sm" data-testid="order-cancelled-reason">
              {t('detail.cancelledReason', { reason: detail.order.cancellationReason })}
            </p>
          )}

          <Button asChild variant="secondary">
            <Link href="/orders">{t('detail.backToOrders')}</Link>
          </Button>
        </aside>
      </div>
    </PageShell>
  );
}
