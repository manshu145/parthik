import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { TranslationManagement } from '@/components/admin/translation-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminTranslationRows } from '@/modules/admin-translations';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('translations'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('cms:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [{ categories, brands, products }, t] = await Promise.all([
    listAdminTranslationRows(),
    getTranslations('adminNav'),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-translations">
      <div>
        <h1 className="text-xl font-semibold">{t('translations')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Edit Hindi catalog copy and see translation completeness. CMS pages, coupons and banners
          keep their bilingual editors on their own management screens.
        </p>
      </div>
      <TranslationManagement rows={[...categories, ...brands, ...products]} />
    </div>
  );
}
