import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { ProviderSettingsForm } from '@/components/admin/provider-settings-form';
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
  return { title: t('paymentSettings'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('setting:manage_sensitive');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [t, settings] = await Promise.all([getTranslations('adminNav'), listProviderSettings()]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-payment-settings">
      <div>
        <h1 className="text-xl font-semibold">{t('paymentSettings')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Encrypted provider-settings registry for Maps, Razorpay, Firebase and analytics. Runtime
          adapters still read deployment environment variables, so saving registry values does not
          switch live integrations. Use the deployment secret manager and redeploy to apply keys.
        </p>
      </div>

      <div className="rounded-xl border p-4">
        <h2 className="font-semibold">Before changing production credentials</h2>
        <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>
            Use restricted production keys from the provider console, not unrestricted test keys.
          </li>
          <li>Keep webhook secrets and service-account private keys server-side.</li>
          <li>All runtime credentials must be applied through the deployment secret manager and redeployed; registry entries alone are not active.</li>
          <li>
            Verify the provider health page and a staged transaction before enabling real orders.
          </li>
        </ul>
      </div>

      <ProviderSettingsForm initial={settings} />
    </div>
  );
}
