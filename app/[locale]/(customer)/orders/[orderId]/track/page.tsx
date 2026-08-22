import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { PageShell } from '@/components/layout/page-shell';
import { OrderTracker } from '@/components/orders/order-tracker';
import { Button } from '@/components/ui/button';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { NotFoundError } from '@/lib/errors';
import { getOrderService } from '@/modules/order';

/**
 * Live order tracking (D-22, docs/ROUTES.md §5).
 *
 * The first snapshot is SERVER-RENDERED and the client polls from there. Rendering an empty
 * shell and fetching on mount would show a spinner to a customer whose only question is
 * "where is my food" — the answer is already known at request time, so it is in the HTML.
 *
 * Polling rather than websockets is D-22. The reasoning and the intervals live in
 * `components/orders/order-tracker.tsx`.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'orders' });

  return { title: t('track.title'), robots: { index: false, follow: false } };
}

export default async function TrackOrderPage({
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
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  return (
    <PageShell title={t('track.title')}>
      <div className="flex max-w-2xl flex-col gap-4">
        <OrderTracker
          orderId={detail.order.id}
          orderNumber={detail.order.orderNumber}
          initial={{
            status: detail.order.status,
            // Computed on the server so the client does not keep its own copy of which
            // statuses count as in-flight — one definition, in `order.state.ts`.
            isActive: service.isActive(detail.order.status),
            estimatedDeliveryAt: detail.order.estimatedDeliveryAt,
            timeline: detail.timeline,
          }}
        />

        <Button asChild variant="secondary" className="self-start">
          <Link href={`/orders/${detail.order.id}`}>{t('track.backToOrder')}</Link>
        </Button>
      </div>
    </PageShell>
  );
}
