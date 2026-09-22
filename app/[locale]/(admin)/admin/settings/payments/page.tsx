import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GuardedDashboardPage } from '@/app/_components/guarded-dashboard-page';
import { ProviderSettingsForm } from '@/components/admin/provider-settings-form';
import { listProviderSettings } from '@/modules/provider-settings';

export const dynamic = 'force-dynamic';

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
  return { title: t('paymentSettings'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('adminNav');
  const tDashboard = await getTranslations('dashboard');
  const settings = await listProviderSettings();

  return (
    <GuardedDashboardPage
      title={t('paymentSettings')}
      permission={'setting:manage_sensitive'}
      pendingLabel={tDashboard('pendingLabel')}
      pendingDescription={tDashboard('pendingDescription')}
    >
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          Manage Maps, Razorpay, Firebase and analytics credentials. Missing providers fail with an
          explicit configuration error; secret values are encrypted and never returned to the
          browser.
        </p>
        <ProviderSettingsForm initial={settings} />
      </div>
    </GuardedDashboardPage>
  );
}
