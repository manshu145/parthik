import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DriverConsole } from '@/components/driver/driver-console';
import { requireCurrentActor } from '@/lib/auth/current-actor';

/**
 * The active job. Same console again — a driver with no delivery gets the offer list rather than an
 * empty screen telling them to go somewhere else.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'driverNav' });

  return { title: t('active'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireCurrentActor();

  const t = await getTranslations('driverNav');

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('active')}</h1>
      <DriverConsole />
    </div>
  );
}
