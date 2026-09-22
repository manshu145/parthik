import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { BannerManagement } from '@/components/admin/home-marketing-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminBanners } from '@/modules/admin-marketing';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('banners'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('banner:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t] = await Promise.all([listAdminBanners(), getTranslations('adminNav')]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-banners">
      <div>
        <h1 className="text-xl font-semibold">{t('banners')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage localized scheduled banners by placement, audience and delivery zone.
        </p>
      </div>
      <BannerManagement
        rows={rows.map((row) => ({
          ...row,
          startsAt: row.startsAt?.toISOString() ?? null,
          endsAt: row.endsAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
