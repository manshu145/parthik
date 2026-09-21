import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { BrandEditor } from '@/components/admin/master-data-editors';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminBrands } from '@/modules/admin-configuration';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('brands'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('brand:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t] = await Promise.all([listAdminBrands(), getTranslations('adminNav')]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4" data-testid="admin-brands">
      <div>
        <h1 className="text-xl font-semibold">{t('brands')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Brand status और catalog usage का live view।'
            : 'Live view of brand status and catalog usage.'}
        </p>
      </div>

      <BrandEditor rows={rows} />
    </div>
  );
}
