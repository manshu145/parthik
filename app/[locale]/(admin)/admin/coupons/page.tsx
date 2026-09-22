import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { CouponManagement } from '@/components/admin/coupon-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminCoupons } from '@/modules/admin-marketing';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('coupons'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('coupon:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t] = await Promise.all([listAdminCoupons(), getTranslations('adminNav')]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-coupons">
      <div>
        <h1 className="text-xl font-semibold">{t('coupons')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Create and edit coupons consumed by the live cart pricing engine. Eligibility and
          limits are enforced server-side on every evaluation.
        </p>
      </div>
      <CouponManagement
        rows={rows.map((row) => ({
          ...row,
          validFrom: row.validFrom?.toISOString() ?? null,
          validUntil: row.validUntil?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
