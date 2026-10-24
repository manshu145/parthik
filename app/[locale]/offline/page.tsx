import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OfflineState } from '@/components/feedback/states';

/**
 * Offline fallback, served by the service worker when a navigation fails
 * (master spec §38, docs/ROUTES.md §9).
 *
 * Deliberately NOT wrapped in the shop shell: the shell mounts client components
 * that expect network availability, and this page must render from cache alone.
 * It is precached in both locales so an offline Hindi user sees Hindi.
 *
 * The copy is honest about the limits — browsing works offline, ordering does not.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.offline' });

  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('states.offline');

  return (
    <main
      id="main"
      data-testid="offline-page"
      className="mx-auto flex min-h-dvh max-w-xl items-center justify-center p-6"
    >
      <OfflineState title={t('title')} description={t('description')} />
    </main>
  );
}
