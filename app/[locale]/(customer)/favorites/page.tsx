import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageShell, ShellPlaceholderNotice } from '@/components/layout/page-shell';
import { EmptyState } from '@/components/feedback/states';

/**
 * Favorites — SHELL ONLY.
 *
 * Session-gated by middleware, so an unauthenticated visitor is redirected to
 * `/login?next=/favorites` before this renders.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.favorites' });

  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function FavoritesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pages.favorites');
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
