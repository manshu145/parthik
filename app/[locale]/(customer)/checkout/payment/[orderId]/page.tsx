import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isLocale, routing } from '@/i18n/routing';
import { PageShell } from '@/components/layout/page-shell';
import { PaymentHandoff } from '@/components/payments/payment-handoff';
import { Button } from '@/components/ui/button';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { NotFoundError } from '@/lib/errors';
import { getOrderService } from '@/modules/order';

/**
 * Gateway handoff for a prepaid order (docs/ROUTES.md §5, D-13).
 *
 * The route is `/checkout/payment/[orderId]` rather than the bare `/checkout/payment` the spec
 * lists. Deliberate: the page has to know WHICH order it is collecting for, and a path segment
 * gets the same ownership check as every other order route rather than depending on session
 * state that a reload would lose.
 *
 * COD NEVER REACHES HERE. A cash order is created CONFIRMED with nothing to collect online
 * (D-12), so it is redirected to the order page — landing a cash customer on a payment screen
 * would be a request to pay twice.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'payments' });

  // Never indexable: per-customer, and it names an amount owed.
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ locale: string; orderId: string }>;
}) {
  const { locale, orderId } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('payments');
  const actor = await requireCurrentActor();
  const service = await getOrderService();

  const detail = await service.getForUser(actor.userId, orderId).catch((error: unknown) => {
    // Another customer's order and a nonexistent one are the same answer.
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const prefix = locale === routing.defaultLocale ? '' : `/${locale}`;

  /**
   * Anything already settled goes to the order page.
   *
   * Covers the customer who pays, comes back, and hits reload: without this they would be shown
   * a payment screen for an order that is already confirmed and could pay again.
   */
  if (detail.order.isCod || detail.order.status !== 'PENDING_PAYMENT') {
    redirect(`${prefix}/orders/${detail.order.id}`);
  }

  return (
    <PageShell title={t('pageTitle')}>
      <div className="flex max-w-xl flex-col gap-4">
        <PaymentHandoff
          orderId={detail.order.id}
          orderNumber={detail.order.orderNumber}
          amountPaise={detail.order.totalAmountPaise}
          customerName={detail.order.contactName}
          customerPhone={detail.order.contactPhone}
        />

        <Button asChild variant="secondary" className="self-start">
          {/* An escape hatch that does not lose the order: it exists, it is unpaid, and the order
              page can offer the payment again. */}
          <Link href={`/orders/${detail.order.id}`}>{t('viewOrder')}</Link>
        </Button>
      </div>
    </PageShell>
  );
}
