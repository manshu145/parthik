import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DriverCashPanel } from '@/components/driver/cash-panel';
import { requireCurrentActor } from '@/lib/auth/current-actor';

/**
 * The driver's cash screen — REAL SCREEN (docs/ROUTES.md §7, D-12).
 *
 * Exists to make a liability visible. The money in a rider's pocket belongs to the platform, and
 * the most common cause of a dispute is a driver who does not know how much they are carrying —
 * so the float, the limit, the headroom and every movement behind them are all here, and they are
 * the same rows the office sees.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'driverNav' });

  return { title: t('cash'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireCurrentActor();

  const t = await getTranslations('driverNav');

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('cash')}</h1>
      <DriverCashPanel />
    </div>
  );
}
