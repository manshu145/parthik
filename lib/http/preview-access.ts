import { getServerEnv } from '@/lib/config/env';

/**
 * Whether dashboard shells are being served without authentication.
 *
 * Mirrors the middleware predicate exactly (see `middleware.ts`). Duplicated rather
 * than shared because middleware runs on the edge without the validated config, and
 * a server component must not read `process.env` directly — the ESLint rule forbids
 * it. The two conditions are identical and both are asserted by tests.
 *
 * SELF-DISABLING: configuring Firebase closes it with no code change.
 */
export function isUnauthenticatedPreview(): boolean {
  const env = getServerEnv();

  if (env.APP_ENV === 'production') return false;
  return !env.FIREBASE_PROJECT_ID;
}
