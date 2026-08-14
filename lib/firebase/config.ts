import { getClientEnv, getServerEnv } from '@/lib/config/env';
import { ConfigurationError } from '@/lib/errors';

/**
 * Firebase configuration resolution (decision D-08).
 *
 * Both accessors are written so that MISSING CREDENTIALS ARE NOT A CRASH:
 *
 *   - `get*ConfigOrNull()` returns null, letting callers degrade gracefully and
 *     letting the health endpoint report the provider as unconfigured.
 *   - `require*Config()` throws a typed ConfigurationError, so if something does
 *     try to use Firebase without credentials the failure is explicit, mapped to
 *     503, and logged — never an undefined-property mystery.
 *
 * This is verified by tests/unit/firebase-config.test.ts.
 */

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId: string;
  measurementId?: string;
}

export interface FirebaseServerConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  /** Present only when the Auth Emulator is in use (tests/CI). */
  authEmulatorHost?: string;
}

export function getFirebaseClientConfigOrNull(): FirebaseClientConfig | null {
  const env = getClientEnv();

  if (
    !env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    !env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    !env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    !env.NEXT_PUBLIC_FIREBASE_APP_ID ||
    !env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
  ) {
    return null;
  }

  return {
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
    messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    ...(env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
      ? { measurementId: env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID }
      : {}),
  };
}

export function isFirebaseClientConfigured(): boolean {
  return getFirebaseClientConfigOrNull() !== null;
}

export function requireFirebaseClientConfig(): FirebaseClientConfig {
  const config = getFirebaseClientConfigOrNull();
  if (!config) {
    throw new ConfigurationError(
      'Firebase client configuration is missing. Set the NEXT_PUBLIC_FIREBASE_* variables listed in .env.example.'
    );
  }
  return config;
}

/**
 * Server-side Firebase identity. `projectId` alone is enough to VERIFY tokens;
 * the service account is only needed for privileged Identity Platform REST calls
 * (D-36), so the two are reported separately.
 */
export function getFirebaseProjectIdOrNull(): string | null {
  const env = getServerEnv();
  return env.FIREBASE_PROJECT_ID ?? getFirebaseClientConfigOrNull()?.projectId ?? null;
}

export function requireFirebaseProjectId(): string {
  const projectId = getFirebaseProjectIdOrNull();
  if (!projectId) {
    throw new ConfigurationError(
      'FIREBASE_PROJECT_ID is not configured. Token verification cannot proceed without it.'
    );
  }
  return projectId;
}

export function getFirebaseServerConfigOrNull(): FirebaseServerConfig | null {
  const env = getServerEnv();
  const projectId = getFirebaseProjectIdOrNull();

  if (
    !projectId ||
    !env.FIREBASE_SERVICE_ACCOUNT_EMAIL ||
    !env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
  ) {
    return null;
  }

  return {
    projectId,
    clientEmail: env.FIREBASE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY,
    ...(env.FIREBASE_AUTH_EMULATOR_HOST
      ? { authEmulatorHost: env.FIREBASE_AUTH_EMULATOR_HOST }
      : {}),
  };
}

export function isFirebaseServerConfigured(): boolean {
  return getFirebaseServerConfigOrNull() !== null;
}

export function requireFirebaseServerConfig(): FirebaseServerConfig {
  const config = getFirebaseServerConfigOrNull();
  if (!config) {
    throw new ConfigurationError(
      'Firebase server credentials are missing. Set FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT_EMAIL and FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY.'
    );
  }
  return config;
}

/** True when tests/CI should talk to the Auth Emulator instead of Google. */
export function isAuthEmulatorEnabled(): boolean {
  return Boolean(getServerEnv().FIREBASE_AUTH_EMULATOR_HOST);
}
