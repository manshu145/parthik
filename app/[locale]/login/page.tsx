import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getFirebaseClientConfigOrNull } from '@/lib/firebase/config';

/**
 * Sign-in route placeholder.
 *
 * This page exists in TASK 001 only because middleware redirects unauthenticated
 * visitors here — a dangling redirect target would be a defect. It contains NO
 * authentication logic.
 *
 * TASK 003 replaces it with the real flow, which must be a SINGLE client-side
 * state machine (phone entry -> reCAPTCHA -> OTP entry -> token exchange).
 * Firebase's `confirmationResult` lives in browser memory, so splitting OTP entry
 * onto a separate route would destroy it — see docs/ROUTES.md §5.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('common');
  const firebaseReady = getFirebaseClientConfigOrNull() !== null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t('appName')}</CardTitle>
          <CardDescription>
            {/* Deliberately honest rather than showing a dead form. */}
            {firebaseReady
              ? 'Phone sign-in arrives in TASK 003.'
              : 'Sign-in is unavailable: Firebase is not configured in this environment.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Authentication uses Firebase Phone Authentication. The ID token is exchanged for a
            Parthik session at <code className="font-mono">POST /api/v1/auth/session</code>.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
