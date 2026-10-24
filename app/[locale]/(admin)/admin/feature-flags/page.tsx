import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { FeatureFlagManagement } from '@/components/admin/access-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminFeatureFlagManagement } from '@/modules/admin-access';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('flags'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('flag:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [{ flags, zones }, t] = await Promise.all([
    listAdminFeatureFlagManagement(),
    getTranslations('adminNav'),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-feature-flags">
      <div>
        <h1 className="text-xl font-semibold">{t('flags')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Create flags, set rollout percentage and target specific roles or delivery zones.
        </p>
      </div>
      <FeatureFlagManagement flags={flags} zones={zones} />
    </div>
  );
}
