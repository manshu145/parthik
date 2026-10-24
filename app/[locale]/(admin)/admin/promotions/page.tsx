import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { PromotionManagement } from '@/components/admin/promotion-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminPromotions } from '@/modules/admin-marketing';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('promotions'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('promotion:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t] = await Promise.all([listAdminPromotions(), getTranslations('adminNav')]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-promotions">
      <div>
        <h1 className="text-xl font-semibold">{t('promotions')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage scheduled promotions. FREE_DELIVERY is connected to live cart and checkout pricing;
          other promotion types remain draft-only until their pricing semantics are approved.
        </p>
      </div>

      <PromotionManagement
        rows={rows.map((row) => ({
          ...row,
          validFrom: row.validFrom?.toISOString() ?? null,
          validUntil: row.validUntil?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
