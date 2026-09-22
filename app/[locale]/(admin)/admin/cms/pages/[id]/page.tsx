import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { CmsPageEditor } from '@/components/admin/cms-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { getAdminCmsPage } from '@/modules/admin-cms';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('cmsPageDetail'), robots: { index: false, follow: false } };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('cms:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [page, t] = await Promise.all([getAdminCmsPage(id), getTranslations('adminNav')]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-cms-page-editor">
      <div>
        <h1 className="text-xl font-semibold">{t('cmsPageDetail')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          /{page.slug} · {page.status} · version {page.version}
        </p>
      </div>
      <CmsPageEditor page={page} />
    </div>
  );
}
