import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageShell, ShellPlaceholderNotice } from '@/components/layout/page-shell';
import { EmptyState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * Cart page — SHELL ONLY.
 *
 * GUEST-OK: reachable without signing in (docs/ROUTES.md §5). Renders the empty
 * state, because there is no cart persistence or pricing yet — both arrive with
 * the cart task. No totals are computed here; that is the `pricing` module's job.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.cart' });

  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function CartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pages.cart');
  const tCart = await getTranslations('cart');
  const tShell = await getTranslations('shell');

  return (
    <PageShell title={t('heading')}>
      <div className="flex flex-col gap-6">
        <ShellPlaceholderNotice label={tShell('placeholderNotice')} />

        {/* An empty cart is a normal state, not an error (master spec §25), and it
            tells the customer exactly what to do next. */}
        <EmptyState
          title={tCart('emptyTitle')}
          description={tCart('pageEmptyDescription')}
          action={
            <Button asChild>
              <Link href="/categories">{tCart('startShopping')}</Link>
            </Button>
          }
        />
      </div>
    </PageShell>
  );
}
