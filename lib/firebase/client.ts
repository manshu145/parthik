'use client';

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirebaseClientConfigOrNull, isFirebaseClientConfigured } from './config';

/**
 * Firebase client SDK bootstrap (decision D-08).
 *
 * Every accessor returns null when Firebase is unconfigured rather than
 * throwing, so the application still renders in a local environment without
 * Firebase credentials. Callers that genuinely need auth surface a clear
 * "sign-in unavailable" state instead of a blank screen.
 *
 * The sign-in flow itself is TASK 003. This file only provides the app/auth
 * handles it will use.
 */

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (app) return app;

  const config = getFirebaseClientConfigOrNull();
  if (!config) return null;

  app = getApps().length > 0 ? getApp() : initializeApp(config);
  return app;
}

export function getFirebaseAuth(): Auth | null {
  const instance = getFirebaseApp();
  if (!instance) return null;

  const auth = getAuth(instance);

  // Firebase sends the OTP SMS, so the message language is Google's, not ours
  // (documented as deviation V-2). This at least passes the user's locale hint.
  if (typeof document !== 'undefined') {
    auth.languageCode = document.documentElement.lang || 'en';
  }

  return auth;
}

export { isFirebaseClientConfigured };
