'use client';

import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import { getFirebaseClientConfigOrNull, isFirebaseClientConfigured } from './config';

/**
 * Firebase client SDK bootstrap (decision D-08).
 *
 * THE SDK IS LOADED DYNAMICALLY, AND THAT IS NOT A MICRO-OPTIMISATION.
 *
 * `firebase/app` + `firebase/auth` are roughly 300 KB gzipped. A static import here put them in
 * the static module graph of `components/auth/phone-sign-in.tsx`, and Next builds an SSR copy of
 * every client component — so the whole Auth SDK was compiled into the SERVER bundle as well as
 * the browser one. That pushed the Cloudflare Worker past the 3 MB script limit and the deploy
 * started failing, with a build log nobody reads and a green local `pnpm build`.
 *
 * Loading it on demand fixes three things at once:
 *   * the Worker no longer carries a browser-only SDK it can never execute
 *   * the login page stops shipping 300 KB to visitors who are only reading it
 *   * the SDK arrives exactly when someone taps "send code", where a few hundred
 *     milliseconds is invisible next to waiting for an SMS
 *
 * Type-only imports stay static: `import type` is erased at compile time and contributes nothing
 * to either bundle.
 *
 * Every accessor still returns null when Firebase is unconfigured rather than throwing, so the
 * app renders in a local environment with no credentials and the sign-in surface can say
 * "unavailable" instead of showing a blank screen.
 */

let app: FirebaseApp | null = null;

/**
 * Memoises the in-flight import, not just the result.
 *
 * Two taps in quick succession would otherwise start two module loads. `import()` is cached by the
 * runtime, so this is belt and braces — but the app handle below is NOT idempotent to initialise,
 * and this keeps a single promise for both callers to await.
 */
let loading: Promise<FirebaseApp | null> | null = null;

async function loadFirebaseApp(): Promise<FirebaseApp | null> {
  if (app) return app;

  const config = getFirebaseClientConfigOrNull();
  if (!config) return null;

  if (!loading) {
    loading = (async () => {
      const { getApp, getApps, initializeApp } = await import('firebase/app');
      // `getApps()` guards against a double initialise across a fast refresh or a second caller.
      app = getApps().length > 0 ? getApp() : initializeApp(config);
      return app;
    })();
  }

  return loading;
}

/** The Firebase app handle, or null when Firebase is not configured. */
export async function getFirebaseApp(): Promise<FirebaseApp | null> {
  return loadFirebaseApp();
}

export async function getFirebaseAuth(): Promise<Auth | null> {
  const instance = await loadFirebaseApp();
  if (!instance) return null;

  const { getAuth } = await import('firebase/auth');
  const auth = getAuth(instance);

  // Firebase sends the OTP SMS, so the message language is Google's, not ours (documented as
  // deviation V-2). This at least passes the user's locale hint.
  if (typeof document !== 'undefined') {
    auth.languageCode = document.documentElement.lang || 'en';
  }

  return auth;
}

export { isFirebaseClientConfigured };
