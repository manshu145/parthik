import { getServerEnv } from '@/lib/config/env';

/**
 * Whether the development sign-in endpoint is active.
 *
 * This REPLACES the former `isUnauthenticatedPreview()`, which reported whether
 * dashboard shells were being served with no authentication at all. That switch is
 * gone: privileged routes are now always gated, in every environment.
 *
 * What remains is narrower and must be opted into explicitly. It is surfaced to the
 * UI so a development build can show an honest "you are signed in as a demo user"
 * affordance rather than leaving someone to wonder why they have admin access.
 */
export function isDevAuthEnabled(): boolean {
  const env = getServerEnv();

  // Production is unconditional and checked first, so no later change to the opt-in
  // can accidentally enable this against real users.
  if (env.APP_ENV === 'production') return false;
  return env.DEV_AUTH_ENABLED;
}
