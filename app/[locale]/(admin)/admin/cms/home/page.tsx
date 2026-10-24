import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { HomeLayoutManagement } from '@/components/admin/home-marketing-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminHomeLayouts } from '@/modules/admin-marketing';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('cmsHome'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('cms:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t] = await Promise.all([listAdminHomeLayouts(), getTranslations('adminNav')]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-cms-home">
      <div>
        <h1 className="text-xl font-semibold">{t('cmsHome')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Control homepage section order, visibility, limits and zone-specific active layouts
          without a deployment.
        </p>
      </div>
      <HomeLayoutManagement
        rows={rows.map((row) => ({
          ...row,
          validFrom: row.validFrom?.toISOString() ?? null,
          validUntil: row.validUntil?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
