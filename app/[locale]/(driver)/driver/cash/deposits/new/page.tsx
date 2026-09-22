import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DriverCashPanel } from '@/components/driver/cash-panel';
import { requireCurrentActor } from '@/lib/auth/current-actor';

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
  const t = await getTranslations({ locale, namespace: 'driverNav' });

  // Every dashboard route is noindex (docs/ROUTES.md §6–§8).
  return { title: t('depositNew'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('driverNav');
  await requireCurrentActor();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('depositNew')}</h1>
      <DriverCashPanel />
    </div>
  );
}
