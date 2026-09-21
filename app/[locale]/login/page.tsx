import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PhoneSignIn } from '@/components/auth/phone-sign-in';
import { TemporarySignIn } from '@/components/auth/temporary-sign-in';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentActor } from '@/lib/auth/current-actor';
import { homePathForSurface, isSafeRedirectTarget } from '@/lib/http/route-access';
import { describeAuthReadiness, landingSurfaceForRoles } from '@/modules/identity';
import { getServerEnv } from '@/lib/config/env';

/**
 * Sign-in (TASK 003).
 *
 * A server component that renders the client state machine, so the page itself stays
 * indexable-free, locale-correct and able to redirect an already-signed-in visitor
 * before any JavaScript loads.
 *
 * The interactive flow MUST live in one client component: Firebase's
 * `confirmationResult` and its reCAPTCHA verifier exist only in browser memory, so a
 * navigation between phone entry and OTP entry would destroy them
 * (docs/ROUTES.md §5).
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Sessions differ per visitor, so this page can never be statically cached. */
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { next } = await searchParams;
  const t = await getTranslations('auth');

  /**
   * Validated HERE, on the server, before it is ever handed to the client.
   *
   * `?next=` is attacker-controlled: without this check a crafted link could bounce a
   * freshly authenticated user to an external site that looks like Parthik. Only
   * internal single-slash paths survive.
   */
  const safeNext = next && isSafeRedirectTarget(next) && next !== '/login' ? next : undefined;

  // An already-signed-in visitor has no business on the sign-in page.
  const actor = await getCurrentActor();
  if (actor) {
    const roleKeys = actor.roles.map((grant) => grant.roleKey);
    redirect(safeNext ?? homePathForSurface(landingSurfaceForRoles(roleKeys)));
  }

  const readiness = describeAuthReadiness();
  const env = getServerEnv();
  const temporaryAuthEnabled = env.TEMP_AUTH_ENABLED && Boolean(env.TEMP_AUTH_PASSWORD);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            {temporaryAuthEnabled
              ? 'Sign in to Parthik'
              : readiness.ready
                ? t('title')
                : t('unavailable.title')}
          </CardTitle>
          <CardDescription>
            {temporaryAuthEnabled
              ? 'Use your temporary dashboard username and password.'
              : readiness.ready
                ? t('subtitle')
                : /**
                   * Names the missing variables rather than saying "unavailable".
                   * A developer on a fresh clone needs to know WHICH credential is
                   * absent; an opaque message costs an afternoon.
                   */
                  t('unavailable.description', { missing: readiness.missing.join(', ') })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {temporaryAuthEnabled ? (
            <TemporarySignIn nextPath={safeNext} />
          ) : readiness.ready ? (
            <PhoneSignIn nextPath={safeNext} />
          ) : (
            <p className="text-muted-foreground text-sm" data-testid="signin-unavailable">
              {t('unavailable.description', { missing: readiness.missing.join(', ') })}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
