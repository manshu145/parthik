import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { NotFoundState } from '@/components/feedback/states';
import { Link } from '@/i18n/navigation';

/**
 * Branded 404 (master spec §20). Offers a route onward rather than a dead end.
 *
 * ⚠️ NOINDEX IS LOAD-BEARING, not decoration. Next.js applies automatic Suspense
 * boundaries to dynamic routes, so a `notFound()` raised while resolving a product
 * or category renders this page with an HTTP 200 — a "soft 404". Without an explicit
 * noindex, search engines would index every mistyped product URL as a real page.
 * The status code is a framework limitation; the indexing consequence is not.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};
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
