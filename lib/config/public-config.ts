/**
 * Small, safe reads of public configuration for use in server components.
 *
 * Kept inside lib/config because that is the only place permitted to touch
 * process.env (docs/ARCHITECTURE.md §5.1). This exists so a page can display the
 * environment without importing the full validated server config, which would
 * throw in contexts where optional server-only variables are absent.
 */

export type AppEnvironment = 'development' | 'preview' | 'staging' | 'production';

export function getPublicAppEnv(): AppEnvironment {
  const value = process.env.APP_ENV;

  if (value === 'preview' || value === 'staging' || value === 'production') {
    return value;
  }

  return 'development';
}

export function getPublicAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? process.env.PUBLIC_APP_URL ?? 'http://localhost:3000';
}

/**
 * True when the app is served over HTTPS, which governs `Secure` cookies and the
 * `__Host-` cookie prefix.
 *
 * Everything except local development is HTTPS, so preview and staging get the
 * same cookie hardening as production rather than being accidentally weaker.
 */
export function isSecureContextExpected(): boolean {
  return getPublicAppEnv() !== 'development';
}
