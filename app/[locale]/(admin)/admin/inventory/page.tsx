import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DashboardPage } from '@/components/layout/dashboard-page';

/**
 * Route is live, screen is pending. See components/layout/dashboard-page.tsx for
 * why a shared placeholder is the honest choice here.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });

  // Every dashboard route is noindex (docs/ROUTES.md §6–§8).
  return { title: t('inventory'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('adminNav');
  const tDashboard = await getTranslations('dashboard');

  return (
    <DashboardPage
      title={t('inventory')}
      permission={'inventory:view'}
      pendingLabel={tDashboard('pendingLabel')}
      pendingDescription={tDashboard('pendingDescription')}
    />
  );
}
