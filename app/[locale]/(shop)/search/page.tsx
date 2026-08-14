import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState } from '@/components/feedback/states';

/**
 * Search — SHELL ONLY. Indexing and querying arrive with the search task.
 *
 * `noindex` because search result pages are thin and duplicative of category
 * pages (docs/ROUTES.md §11).
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.search' });

  return {
    title: t('title'),
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('search');
  const tPage = await getTranslations('pages.search');

  return (
    <PageShell
      title={tPage('heading')}
      // Echoes the term so the search form is demonstrably wired to this route.
      description={q ? `${t('queryLabel')}: “${q}”` : undefined}
    >
      <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
    </PageShell>
  );
}
