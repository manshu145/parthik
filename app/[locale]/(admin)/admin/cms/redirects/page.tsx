import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { RedirectManager } from '@/components/admin/cms-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminRedirects } from '@/modules/admin-cms';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('cmsRedirects'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('cms:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t] = await Promise.all([listAdminRedirects(), getTranslations('adminNav')]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-cms-redirects">
      <div>
        <h1 className="text-xl font-semibold">{t('cmsRedirects')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage safe site-relative redirects for slug changes and legacy URLs.
        </p>
      </div>
      <RedirectManager rows={rows} />
    </div>
  );
}
