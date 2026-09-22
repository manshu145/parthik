import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { BlogManagement } from '@/components/admin/blog-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminBlogPosts } from '@/modules/blog';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('cmsBlog'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('cms:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t] = await Promise.all([listAdminBlogPosts(), getTranslations('adminNav')]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-cms-blog">
      <div>
        <h1 className="text-xl font-semibold">{t('cmsBlog')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Create, localize, publish and SEO-manage articles shown on the public blog.
        </p>
      </div>
      <BlogManagement
        rows={rows.map((row) => ({
          ...row,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
