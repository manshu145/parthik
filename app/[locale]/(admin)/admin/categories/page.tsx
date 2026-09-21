import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { CategoryEditor } from '@/components/admin/master-data-editors';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminCategories } from '@/modules/admin-configuration';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('categories'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('category:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t] = await Promise.all([listAdminCategories(), getTranslations('adminNav')]);
  const names = new Map(rows.map((row) => [row.id, row.name]));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-categories">
      <div>
        <h1 className="text-xl font-semibold">{t('categories')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Catalog category tree, visibility और product coverage का live view।'
            : 'Live view of the catalog category tree, visibility and product coverage.'}
        </p>
      </div>

      <CategoryEditor rows={rows} />
    </div>
  );
}
