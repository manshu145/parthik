import { getTranslations } from 'next-intl/server';
import { LoadingState } from '@/components/feedback/states';

/**
 * Route-level loading state (master spec §25).
 * Announced politely via aria-live rather than silently swapping content.
 */
export default async function Loading() {
  const t = await getTranslations('states.loading');

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-center justify-center p-6">
      <LoadingState title={t('label')} />
    </main>
  );
}
