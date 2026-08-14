import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageShell, ShellPlaceholderNotice } from '@/components/layout/page-shell';
import { EmptyState } from '@/components/feedback/states';

/**
 * Category detail — SHELL ONLY (docs/ROUTES.md §4).
 *
 * Exists at this stage so the "Categories" tab stays active while on a category
 * page, which is the `activePrefixes` behaviour in the navigation config. Filters,
 * sorting and products arrive with the catalogue task.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.category' });

  return {
    title: `${t('title')}: ${slug}`,
    // No canonical or Product/Breadcrumb JSON-LD yet: emitting structured data
    // for a page with no real content would be misleading to crawlers.
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const tShell = await getTranslations('shell');

  return (
    <PageShell title={slug}>
      <div className="flex flex-col gap-6">
        <ShellPlaceholderNotice label={tShell('placeholderNotice')} />
        <EmptyState
          title={tShell('notImplementedTitle')}
          description={tShell('notImplementedDescription')}
        />
      </div>
    </PageShell>
  );
}
