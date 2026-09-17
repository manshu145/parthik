import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
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

      {rows.length === 0 ? (
        <Card><CardContent className="p-4 text-sm">No categories configured.</CardContent></Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Parent</th>
                  <th className="px-4 py-3 font-medium">Products</th>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.name}</p>
                      <p className="text-muted-foreground mt-1 text-xs">/{row.slug}</p>
                    </td>
                    <td className="px-4 py-3">{row.parentId ? names.get(row.parentId) ?? 'Parent category' : 'Root'}</td>
                    <td className="px-4 py-3">{row.productCount}</td>
                    <td className="px-4 py-3">{row.displayOrder}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={row.isActive ? 'success' : 'neutral'}>
                          {row.isActive ? 'ACTIVE' : 'INACTIVE'}
                        </Badge>
                        {row.isFeatured ? <Badge variant="warning">FEATURED</Badge> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
