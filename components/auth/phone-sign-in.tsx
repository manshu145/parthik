'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getFirebaseAuth } from '@/lib/firebase/client';

/**
 * Phone sign-in as a SINGLE client-side state machine (docs/ROUTES.md §5).
 *
 * WHY ONE COMPONENT AND NOT TWO ROUTES: Firebase's `confirmationResult` — the only
 * handle capable of confirming the OTP — exists solely in browser memory. Navigating
 * to a `/verify-otp` page destroys it, and the code can then never be confirmed. The
 * original design had exactly that split and it was corrected in the pre-code audit;
 * this comment exists so it is not reintroduced.
 *
 * The reCAPTCHA verifier is also stateful and attached to a live DOM node, which is
 * the second reason this cannot span a navigation.
 */

type Phase = 'phone' | 'otp' | 'exchanging' | 'done';

/** Firebase requires E.164; the UI collects 10 digits and prefixes +91. */
const INDIA_DIALLING_CODE = '+91';
const PHONE_DIGITS = 10;
const OTP_DIGITS = 6;

/** Seconds before "resend" is offered, to avoid burning billable SMS on impatience. */
const RESEND_COOLDOWN_SECONDS = 30;

export interface PhoneSignInProps {
  /** Where to go after a successful sign-in, when the server did not choose. */
  nextPath?: string | undefined;
}

export function PhoneSignIn({ nextPath }: PhoneSignInProps) {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();

  const [phase, setPhase] = useState<Phase>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  /**
   * Both handles are refs, not state: they are imperative Firebase objects, they must
   * survive re-renders, and mutating them must never trigger one.
   */
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const recaptchaHostRef = useRef<HTMLDivElement>(null);

  // Countdown for the resend affordance.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Release the verifier on unmount; a leaked one blocks a later attempt on the
  // same DOM node.
  useEffect(() => {
    return () => {
      verifierRef.current?.clear();
      verifierRef.current = null;
    };
  }, []);

  /**
   * Lazily creates the invisible reCAPTCHA verifier.
   *
   * Firebase MANDATES this for web phone auth — it is not optional hardening, and it
   * is also the control that protects a real cost, since each verification is billed
   * (docs/ARCHITECTURE.md §11.1).
   */
  const ensureVerifier = useCallback(async () => {
    if (verifierRef.current) return verifierRef.current;

    // Awaited: the SDK is fetched on demand so it stays out of the server bundle and off
    // the critical path for anyone who is only reading the page.
    const auth = await getFirebaseAuth();
    if (!auth || !recaptchaHostRef.current) return null;

    const { RecaptchaVerifier } = await import('firebase/auth');
    verifierRef.current = new RecaptchaVerifier(auth, recaptchaHostRef.current, {
      size: 'invisible',
    });

    return verifierRef.current;
  }, []);

  const submitPhone = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);

      const digits = phone.replace(/\D/g, '');
      if (digits.length !== PHONE_DIGITS) {
        setError(t('errors.invalidPhone'));
        return;
      }

      setBusy(true);
      try {
        const auth = await getFirebaseAuth();
        const verifier = await ensureVerifier();
        if (!auth || !verifier) {
          setError(t('errors.recaptcha'));
          return;
        }

        const { signInWithPhoneNumber } = await import('firebase/auth');
        confirmationRef.current = await signInWithPhoneNumber(
          auth,
          `${INDIA_DIALLING_CODE}${digits}`,
          verifier
        );

        setPhase('otp');
        setCooldown(RESEND_COOLDOWN_SECONDS);
      } catch (caught) {
        setError(mapFirebaseError(caught, t));
        // A failed attempt leaves the verifier unusable, so it is discarded and a
        // fresh one is built on retry. Reusing it produces an opaque second failure.
        verifierRef.current?.clear();
        verifierRef.current = null;
      } finally {
        setBusy(false);
      }
    },
    [phone, ensureVerifier, t]
  );

  const submitCode = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);

      const digits = code.replace(/\D/g, '');
      if (digits.length !== OTP_DIGITS) {
        setError(t('errors.invalidOtp'));
        return;
      }

      const confirmation = confirmationRef.current;
      if (!confirmation) {
        // Should be unreachable, but recovering to the phone step is far better than
        // an inert button.
        setPhase('phone');
        setError(t('errors.verifyFailed'));
        return;
      }

      setBusy(true);
      try {
        const credential = await confirmation.confirm(digits);
        const idToken = await credential.user.getIdToken();

        setPhase('exchanging');

        // The Firebase token is exchanged for a Parthik session and then discarded;
        // it is never stored and never used as the session itself.
        const response = await fetch('/api/v1/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, locale }),
        });

        const payload = (await response.json()) as {
          success: boolean;
          data?: { landingPath?: string };
          error?: { code?: string };
        };

        if (!response.ok || !payload.success) {
          setPhase('otp');
          setError(mapExchangeError(payload.error?.code, t));
          return;
        }

        setPhase('done');

        /**
         * The SERVER decides where to land, because it knows the roles. `nextPath`
         * only wins when present, and it was already validated server-side as an
         * internal path — an unvalidated `?next=` is an open redirect.
         */
        const destination = nextPath ?? payload.data?.landingPath ?? '/';

        // `refresh()` matters: layouts were server-rendered for an anonymous visitor,
        // so without it the user lands on a signed-in page still showing signed-out
        // navigation.
        router.replace(destination);
        router.refresh();
      } catch (caught) {
        setPhase('otp');
        setError(mapFirebaseError(caught, t));
      } finally {
        setBusy(false);
      }
    },
    [code, locale, nextPath, router, t]
  );

  const restart = useCallback(() => {
    confirmationRef.current = null;
    verifierRef.current?.clear();
    verifierRef.current = null;
    setCode('');
    setError(null);
    setPhase('phone');
  }, []);

  // ---- Signing-in and success states -------------------------------------
  if (phase === 'exchanging' || phase === 'done') {
    return (
      <div className="space-y-3 text-center" aria-live="polite" data-testid="signin-progress">
        <p className="text-sm font-medium">{phase === 'done' ? t('welcome') : t('signingIn')}</p>
        <p className="text-muted-foreground text-sm">{tCommon('loading')}</p>
      </div>
    );
  }

  // ---- OTP entry ---------------------------------------------------------
  if (phase === 'otp') {
    return (
      <form onSubmit={submitCode} className="space-y-4" data-testid="otp-form" noValidate>
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t('otpTitle')}</h2>
          <p className="text-muted-foreground text-sm">
            {t('otpSubtitle', { phone: `${INDIA_DIALLING_CODE} ${phone}` })}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="otp-code" className="block text-sm font-medium">
            {t('otpLabel')}
          </label>
          <Input
            id="otp-code"
            name="code"
            /**
             * `inputMode="numeric"` gives a numeric keypad without `type="number"`,
             * which strips leading zeros and shows useless spinners for a code.
             * `autoComplete="one-time-code"` lets iOS and Android autofill from the SMS.
             */
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={OTP_DIGITS}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            aria-invalid={error !== null}
            aria-describedby={error ? 'signin-error' : undefined}
            autoFocus
            disabled={busy}
          />
        </div>

        <ErrorNotice error={error} />

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t('verifying') : t('verify')}
        </Button>

        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={restart}
            className="text-muted-foreground underline underline-offset-4"
            disabled={busy}
          >
            {t('changeNumber')}
          </button>

          <button
            type="button"
            onClick={submitPhone}
            className="text-muted-foreground underline underline-offset-4 disabled:no-underline disabled:opacity-60"
            disabled={busy || cooldown > 0}
          >
            {cooldown > 0 ? t('resendIn', { seconds: cooldown }) : t('resend')}
          </button>
        </div>

        <div ref={recaptchaHostRef} />
      </form>
    );
  }

  // ---- Phone entry -------------------------------------------------------
  return (
    <form onSubmit={submitPhone} className="space-y-4" data-testid="phone-form" noValidate>
      <div className="space-y-2">
        <label htmlFor="phone" className="block text-sm font-medium">
          {t('phoneLabel')}
        </label>
        <div className="flex gap-2">
          <span
            className="border-border text-muted-foreground flex h-11 items-center rounded-[var(--radius-control)] border px-3 text-sm"
            aria-hidden="true"
          >
            {t('phonePrefix')}
          </span>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={PHONE_DIGITS}
            placeholder="9876543210"
            value={phone}
            onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}
            aria-invalid={error !== null}
            aria-describedby={error ? 'signin-error' : 'phone-hint'}
            disabled={busy}
          />
        </div>
        <p id="phone-hint" className="text-muted-foreground text-xs">
          {t('phoneHint')}
        </p>
      </div>

      <ErrorNotice error={error} />

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t('sending') : t('sendCode')}
      </Button>

      <p className="text-muted-foreground text-xs">{t('termsNotice')}</p>

      {/* Invisible reCAPTCHA mounts here. */}
      <div ref={recaptchaHostRef} />
    </form>
  );
}

/** `role="alert"` so screen readers announce the failure without a focus change. */
function ErrorNotice({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <p id="signin-error" role="alert" className="text-danger text-sm" data-testid="signin-error">
      {error}
    </p>
  );
}

type Translator = ReturnType<typeof useTranslations<'auth'>>;

/**
 * Maps Firebase error codes to our own copy.
 *
 * Firebase messages are English-only and often mention internals, so they are never
 * shown directly — that would break the bilingual requirement (D-33) at the very
 * first touchpoint and leak implementation detail.
 */
function mapFirebaseError(caught: unknown, t: Translator): string {
  const code =
    typeof caught === 'object' && caught !== null && 'code' in caught
      ? String((caught as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/invalid-phone-number':
      return t('errors.invalidPhone');
    case 'auth/invalid-verification-code':
      return t('errors.otpIncorrect');
    case 'auth/code-expired':
    case 'auth/session-expired':
      return t('errors.otpExpired');
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return t('errors.tooManyRequests');
    case 'auth/network-request-failed':
      return t('errors.network');
    case 'auth/captcha-check-failed':
    case 'auth/missing-app-credential':
      return t('errors.recaptcha');
    default:
      return t('errors.sendFailed');
  }
}

/** Maps our own API error codes (docs/API_SPEC.md §5) to copy. */
function mapExchangeError(code: string | undefined, t: Translator): string {
  switch (code) {
    case 'ACCOUNT_SUSPENDED':
      return t('errors.accountSuspended');
    case 'RATE_LIMITED':
      return t('errors.tooManyRequests');
    case 'FIREBASE_TOKEN_EXPIRED':
      return t('errors.otpExpired');
    case 'FIREBASE_TOKEN_INVALID':
    case 'FIREBASE_PROVIDER_NOT_ALLOWED':
    case 'PHONE_CLAIM_MISSING':
      return t('errors.verifyFailed');
    default:
      return t('errors.sessionFailed');
  }
}
