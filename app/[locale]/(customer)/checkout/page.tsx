import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { CheckoutFlow } from '@/components/checkout/checkout-flow';
import { EmptyState } from '@/components/feedback/states';
import { PageShell } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { loadCart } from '@/lib/shell/cart-session';
import { getCheckoutService } from '@/modules/checkout';
import { getCustomerService } from '@/modules/customer';

/**
 * Checkout (master spec §12, docs/ROUTES.md §5).
 *
 * The FIRST quote is computed on the server so the page arrives with a real total, a real
 * delivery fee and real blockers — no spinner, and nothing that changes under the customer
 * a moment after it renders. Subsequent selections re-quote through the API.
 *
 * Session-gated by middleware, and `requireCurrentActor` re-checks here because middleware
 * trusts cookie claims while this needs a live session (there is no guest checkout in V1:
 * an order needs an owner for tracking, support and refunds).
 *
 * 🔴 NO TAX LINE anywhere on this page. D-14 is blocked (docs/ARCHITECTURE.md §11.2.2).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'checkout' });

  // Never indexable: per-customer, and it holds an address.
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('checkout');
  const tCart = await getTranslations('cart');

  const actor = await requireCurrentActor();

  const [{ intent }, checkout, customer] = await Promise.all([
    loadCart(),
    getCheckoutService(),
    getCustomerService(),
  ]);

  // An empty cart has nothing to check out. Handled before quoting so the customer gets a
  // way forward instead of a page full of blockers.
  if (intent.lines.length === 0) {
    return (
      <PageShell title={t('title')}>
        <EmptyState
          title={tCart('emptyTitle')}
          description={tCart('pageEmptyDescription')}
          action={
            <Button asChild>
              <Link href="/">{tCart('startShopping')}</Link>
            </Button>
          }
        />
      </PageShell>
    );
  }

  const [quote, addresses] = await Promise.all([
    checkout.quote({ intent, locale, userId: actor.userId }),
    customer.listAddresses(actor.userId),
  ]);

  return (
    <PageShell title={t('title')}>
      <CheckoutFlow initialQuote={quote} addresses={addresses} />
    </PageShell>
  );
}
