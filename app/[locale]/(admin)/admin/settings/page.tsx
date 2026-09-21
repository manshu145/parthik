import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { ProviderSettingsForm } from '@/components/admin/provider-settings-form';
import { Card, CardContent } from '@/components/ui/card';
import { currentActorCan } from '@/lib/auth/current-actor';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listProviderSettings } from '@/modules/provider-settings';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('settings'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('setting:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [t, canManageSensitive] = await Promise.all([
    getTranslations('adminNav'),
    currentActorCan('setting:manage_sensitive'),
  ]);

  const providerSettings = canManageSensitive ? await listProviderSettings() : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-settings">
      <div>
        <h1 className="text-xl font-semibold">{t('settings')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Platform configuration, external APIs और runtime readiness का central control panel।'
            : 'Central control panel for platform configuration, external APIs and runtime readiness.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href={'/' + locale + '/admin/system-health'} className="block">
          <Card className="h-full transition-shadow hover:shadow-sm">
            <CardContent className="p-4">
              <h2 className="font-semibold">System health</h2>
              <p className="text-muted-foreground mt-2 text-sm">
                Check database and provider readiness without exposing credentials.
              </p>
              <p className="mt-3 text-sm font-medium">Open health dashboard →</p>
            </CardContent>
          </Card>
        </Link>

        <Link href={'/' + locale + '/admin/settings/payments'} className="block">
          <Card className="h-full transition-shadow hover:shadow-sm">
            <CardContent className="p-4">
              <h2 className="font-semibold">Integration settings</h2>
              <p className="text-muted-foreground mt-2 text-sm">
                Maps, Razorpay, Firebase and analytics provider configuration.
              </p>
              <p className="mt-3 text-sm font-medium">Open dedicated page →</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {canManageSensitive && providerSettings ? (
        <Card>
          <CardContent className="p-4">
            <div className="mb-4">
              <h2 className="font-semibold">External API configuration</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Missing credentials stay visible as “Not configured”. Server-side Maps and Razorpay
                changes are consumed by new requests; secret values are encrypted and are never
                returned to the browser.
              </p>
            </div>
            <ProviderSettingsForm initial={providerSettings} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 text-sm">
            <p className="font-medium">External API configuration is restricted.</p>
            <p className="text-muted-foreground mt-1">
              Your current admin role can view settings but cannot edit sensitive provider
              credentials.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
