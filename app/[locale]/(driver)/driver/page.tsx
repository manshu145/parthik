import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DriverConsole } from '@/components/driver/driver-console';
import { requireCurrentActor } from '@/lib/auth/current-actor';

/**
 * The driver's working screen — REAL SCREEN (docs/ROUTES.md §7).
 *
 * NO PERMISSION CHECK, and that is correct: the DRIVER role holds none by design
 * (`modules/identity/permissions.ts`). A driver acts only on their own work, so every endpoint
 * behind this screen authorises by OWNERSHIP — the caller's driver record must own the delivery.
 * The layout's surface guard is what keeps non-drivers out of the surface entirely.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'driverNav' });

  return { title: t('today'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Still asserted, so an unauthenticated request cannot render the shell.
  await requireCurrentActor();

  const t = await getTranslations('driverConsole');

  return (
    <div
      className="mx-auto flex max-w-2xl flex-col gap-4"
      data-testid="driver-console"
    >
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <DriverConsole />
    </div>
  );
}
