import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageShell, ShellPlaceholderNotice } from '@/components/layout/page-shell';
import { EmptyState } from '@/components/feedback/states';

/**
 * Categories — SHELL ONLY. Real category tree arrives with the catalogue task.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.categories' });
  return { title: t('title') };
}

export default async function CategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pages.categories');
  const tShell = await getTranslations('shell');

  return (
    <PageShell title={t('heading')}>
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
