import { isSecureContextExpected } from '@/lib/config/public-config';

/**
 * Session cookie contract (docs/SECURITY.md §3, decision D-10).
 *
 * The Firebase ID token is exchanged for a Parthik session; it is NOT used as
 * the session itself. Rationale (docs/ARCHITECTURE.md §11.1): we need immediate
 * revocation, role-specific lifetimes, and a middleware gate that cannot reach
 * the database or make network calls.
 *
 * TASK 001 defines the contract only. Issuing and verifying sessions is TASK 003.
 */

/**
 * `__Host-` prefix requires Secure, Path=/ and no Domain attribute, which makes
 * the cookie host-locked and immune to subdomain injection.
 *
 * The prefix is dropped in local development because it also requires HTTPS.
 */
export const SESSION_COOKIE_NAME = isSecureContextExpected()
  ? '__Host-parthik_session'
  : 'parthik_session';

export const LOCALE_COOKIE_NAME = 'PARTHIK_LOCALE';
export const ZONE_COOKIE_NAME = 'PARTHIK_ZONE';

/** Session lifetimes per role, approved under D-10. */
export const SESSION_LIFETIMES_SECONDS = {
  customer: 60 * 60 * 24 * 30, // 30 days, rolling
  vendor: 60 * 60 * 24 * 14, // 14 days
  driver: 60 * 60 * 24 * 14, // 14 days
  admin: 60 * 60 * 8, // 8 hours
} as const;

/** Admin sessions additionally expire on inactivity (D-10). */
export const ADMIN_IDLE_TIMEOUT_SECONDS = 60 * 30;

export type SessionAudience = keyof typeof SESSION_LIFETIMES_SECONDS;

/**
 * Claims carried in the signed cookie for MIDDLEWARE ROUTING ONLY.
 *
 * These are never an authorization decision. The service layer revalidates the
 * session against the store on every call, so a stale claim can reach a page
 * shell but never data.
 */
export interface SessionCookieClaims {
  /** Parthik user id. */
  sub: string;
  /** Opaque session id, used to revoke server-side. */
  sid: string;
  /** Role keys held by the user, for coarse surface routing. */
  roles: string[];
  /** Expiry, seconds since epoch. */
  exp: number;
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isSecureContextExpected(),
  sameSite: 'lax',
  path: '/',
} as const;
