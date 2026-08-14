import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { NotFoundState } from '@/components/feedback/states';
import { Link } from '@/i18n/navigation';

/**
 * Branded 404 (master spec §20). Offers a route onward rather than a dead end.
 */
export default async function NotFound() {
  const t = await getTranslations('states.notFound');
  const tCommon = await getTranslations('common');

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-center justify-center p-6">
      <NotFoundState
        title={t('title')}
        description={t('description')}
        action={
          <Button asChild>
            <Link href="/">{tCommon('goHome')}</Link>
          </Button>
        }
      />
    </main>
  );
}
