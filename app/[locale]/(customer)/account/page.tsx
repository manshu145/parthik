import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageShell } from '@/components/layout/page-shell';
import { AccountNav } from '@/components/layout/account-nav';

/**
 * Account hub — SHELL ONLY.
 *
 * Session-gated by middleware. Profile, addresses, notification preferences and
 * security all arrive with their own tasks; this page provides the hub navigation
 * so the Account tab is a real destination rather than a dead end.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.account' });

  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pages.account');
  return (
    <PageShell title={t('heading')}>
      <div className="flex max-w-2xl flex-col gap-6">
        <p className="text-muted-foreground text-sm">Manage your profile, saved addresses, preferences, security and support from one place.</p>
        <AccountNav />
      </div>
    </PageShell>
  );
}
