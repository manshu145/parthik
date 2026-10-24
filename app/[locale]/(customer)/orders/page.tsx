import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { EmptyState } from '@/components/feedback/states';
import { PageShell } from '@/components/layout/page-shell';
import { OrderList } from '@/components/orders/order-list';
import { Button } from '@/components/ui/button';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { getOrderService } from '@/modules/order';

/**
 * Order history (docs/ROUTES.md §5).
 *
 * The FIRST page is server-rendered. Order history is the most common reason a customer opens
 * the app after buying something, so it arrives as HTML rather than as a spinner that resolves
 * into a list.
 *
 * Session-gated by middleware, and `requireCurrentActor` re-checks here because middleware
 * trusts cookie claims while this reads real data.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'orders' });

  // Never indexable: per-customer, and it names what they bought.
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('orders');
  const actor = await requireCurrentActor();

  const service = await getOrderService();
  const page = await service.listForUser(actor.userId, { limit: 20 });

  if (page.items.length === 0) {
    return (
      <PageShell title={t('title')}>
        <EmptyState
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            <Button asChild>
              <Link href="/">{t('empty.action')}</Link>
            </Button>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell title={t('title')}>
      <OrderList initialItems={page.items} initialCursor={page.nextCursor} />
    </PageShell>
  );
}
