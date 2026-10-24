import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { UnauthorizedState } from '@/components/feedback/states';
import type { AccessDecision } from '@/lib/auth/page-guard';

/**
 * Renders an access denial IN PLACE (master spec §25, docs/ROUTES.md §8).
 *
 * Lives under `app/_components/` rather than `components/` for a boundary reason:
 * `components/` may not import `@/modules` (ESLint enforces it), and this needs the
 * `AccessDecision` type from the guard. The underscore keeps it out of the router.
 *
 * The two denial cases get DIFFERENT actions, which is the whole point of separating
 * them: a visitor who is not signed in is offered sign-in, because that fixes their
 * problem. A signed-in user without the permission is not, because it would not — they
 * are offered a way out instead. Showing "Sign in" to someone already signed in is how
 * a permission error becomes a support ticket.
 */
export async function AccessDenied({ decision }: { decision: AccessDecision }) {
  if (decision.status === 'ok') return null;

  const tCommon = await getTranslations('common');

  if (decision.status === 'unauthenticated') {
    const tAuth = await getTranslations('auth');

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <UnauthorizedState
          title={tAuth('title')}
          description={tAuth('subtitle')}
          action={
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/login">{tAuth('sendCode')}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/">{tCommon('goHome')}</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const tState = await getTranslations('states.unauthorized');

  return (
    <div
      className="flex min-h-[60vh] items-center justify-center p-6"
      data-testid="access-forbidden"
    >
      <UnauthorizedState
        title={tState('title')}
        description={tState('description')}
        action={
          <Button asChild variant="secondary">
            <Link href="/">{tCommon('goHome')}</Link>
          </Button>
        }
        {...(decision.permission
          ? // Naming the missing permission turns "why can't I see this?" into an
            // actionable request to an administrator. It reveals nothing about the
            // resource itself, only what would be needed to view it.
            { reference: { label: tState('title'), value: decision.permission } }
          : {})}
      />
    </div>
  );
}
