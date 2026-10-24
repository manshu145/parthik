import { jwtVerify, SignJWT } from 'jose';
import { getServerEnv } from '@/lib/config/env';
import { AuthenticationError, ConfigurationError } from '@/lib/errors';
import type { SessionCookieClaims } from './session-cookie';

/**
 * Session cookie signing and verification (docs/SECURITY.md §3, decision D-10).
 *
 * WHY A SIGNED COOKIE RATHER THAN AN OPAQUE ONE
 *
 * Middleware has to decide, on every navigation, whether a visitor may reach the
 * vendor/driver/admin shell — and on Cloudflare Workers it can reach neither the
 * database nor the cache (docs/ARCHITECTURE.md §4.2). An opaque random token would
 * therefore be unreadable at exactly the point the routing decision is made. A
 * signed JWS is verifiable with a symmetric key and no I/O, so the gate works
 * inside the platform's constraints.
 *
 * The claims are for ROUTING ONLY and are never an authorization decision. They
 * can be stale — a role revoked one second ago is still in a cookie signed a day
 * ago. That is acceptable precisely because the service layer revalidates the
 * session against the database on every call, so a stale claim can reach a page
 * shell and never data.
 *
 * DEFENCE IN DEPTH
 *
 * Two independent secrets must both hold for a session to be usable:
 *
 *   1. AUTH_SECRET signs the cookie, so the claims cannot be forged or edited.
 *   2. A per-session random secret is carried inside the cookie, and only its
 *      SHA-256 hash is stored in `sessions.token_hash`. A database leak therefore
 *      yields no usable session, and a leaked signing key still cannot produce a
 *      cookie that matches a stored hash.
 */

/** Bytes of entropy in the per-session secret. */
const SESSION_SECRET_BYTES = 32;

const ALGORITHM = 'HS256';

/** Matches the `aud` claim, so a cookie cannot be replayed as another token type. */
const AUDIENCE = 'parthik:session';
const ISSUER = 'parthik';

/**
 * Small tolerance for clock skew, mirroring the Firebase verifier. Kept short
 * because this is our own key on our own infrastructure.
 */
const CLOCK_TOLERANCE_SECONDS = 5;

/** The cookie payload: routing claims plus the per-session secret. */
interface SessionTokenPayload extends SessionCookieClaims {
  /** Per-session secret. `sessions.token_hash` stores SHA-256 of this value. */
  tok: string;
  /** Which surface the session was issued for, so lifetimes stay role-correct. */
  aud_surface: string;
}

export interface IssuedSessionToken {
  /** The value to place in the cookie. */
  cookieValue: string;
  /** SHA-256 of the per-session secret, for `sessions.token_hash`. */
  tokenHash: string;
  expiresAt: Date;
}

export interface VerifiedSessionToken {
  userId: string;
  sessionId: string;
  roles: string[];
  surface: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Resolves the signing key.
 *
 * `override` exists for MIDDLEWARE. Middleware runs in the constrained edge
 * environment where the validated server config is not loaded, so it reads
 * `AUTH_SECRET` itself and passes it in rather than triggering a full Zod parse of
 * `process.env` at the edge on every navigation.
 */
function requireAuthSecret(override?: string | undefined): Uint8Array {
  const secret = override ?? getServerEnv().AUTH_SECRET;
  if (!secret) {
    throw new ConfigurationError(
      'AUTH_SECRET is not configured, so sessions cannot be issued or verified. Generate one with `openssl rand -base64 32`.'
    );
  }
  return new TextEncoder().encode(secret);
}

/** True when this environment can issue sessions at all. */
export function canIssueSessions(): boolean {
  return getServerEnv().AUTH_SECRET !== undefined;
}

/** Cryptographically random, URL-safe secret. */
function generateSessionSecret(): string {
  const bytes = new Uint8Array(SESSION_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * SHA-256, hex encoded. Web Crypto so it works identically in Node, on Workers and
 * in the edge middleware environment.
 */
export async function hashSessionSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compares two hashes without leaking timing information.
 *
 * Length is compared first and then every byte is examined regardless of early
 * mismatches, so the duration does not reveal how much of a guess was correct.
 */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Signs a new session cookie.
 *
 * `lifetimeSeconds` comes from SESSION_LIFETIMES_SECONDS keyed by the session's
 * surface, so an admin cookie genuinely expires in 8 hours rather than merely being
 * treated as expired by the server.
 */
export async function issueSessionToken(input: {
  userId: string;
  sessionId: string;
  roles: readonly string[];
  surface: string;
  lifetimeSeconds: number;
}): Promise<IssuedSessionToken> {
  const key = requireAuthSecret();
  const secret = generateSessionSecret();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAt + input.lifetimeSeconds;

  const cookieValue = await new SignJWT({
    sub: input.userId,
    sid: input.sessionId,
    roles: [...input.roles],
    tok: secret,
    aud_surface: input.surface,
    exp: expiresAtSeconds,
  } satisfies Record<string, unknown>)
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setIssuedAt(issuedAt)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(expiresAtSeconds)
    .sign(key);

  return {
    cookieValue,
    tokenHash: await hashSessionSecret(secret),
    expiresAt: new Date(expiresAtSeconds * 1000),
  };
}

/**
 * Verifies a session cookie's signature and claim shape.
 *
 * This proves the cookie was issued by us and has not expired. It does NOT prove
 * the session is still live — revocation, ban and idle timeout are database facts,
 * checked by the identity service. Both steps are required; neither is sufficient.
 *
 * @throws AuthenticationError on a bad signature, expiry or malformed claims
 */
export async function verifySessionToken(
  cookieValue: string,
  secretOverride?: string | undefined
): Promise<VerifiedSessionToken> {
  if (!cookieValue) {
    throw new AuthenticationError('UNAUTHENTICATED', 'Please sign in to continue.');
  }

  const key = requireAuthSecret(secretOverride);

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(cookieValue, key, {
      // Pinning the algorithm is what prevents an `alg` downgrade or `alg: none`.
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const expired = message.includes('exp') || message.toLowerCase().includes('expired');

    throw new AuthenticationError(
      expired ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED',
      expired ? 'Your session has expired. Please sign in again.' : 'Please sign in to continue.',
      { context: { reason: expired ? 'session_token_expired' : 'session_token_invalid' } }
    );
  }

  const claims = readClaims(payload);
  return {
    userId: claims.sub,
    sessionId: claims.sid,
    roles: claims.roles,
    surface: claims.aud_surface,
    tokenHash: await hashSessionSecret(claims.tok),
    expiresAt: new Date(claims.exp * 1000),
  };
}

/**
 * Reads claims defensively.
 *
 * A signature-valid token with the wrong shape is treated as invalid rather than
 * partially trusted — the alternative is an `undefined` user id flowing into a
 * query.
 */
function readClaims(payload: Record<string, unknown>): SessionTokenPayload {
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  const sid = typeof payload.sid === 'string' ? payload.sid : '';
  const tok = typeof payload.tok === 'string' ? payload.tok : '';
  const surface = typeof payload.aud_surface === 'string' ? payload.aud_surface : '';
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((role): role is string => typeof role === 'string')
    : [];

  if (!sub || !sid || !tok || !surface || !exp) {
    throw new AuthenticationError('UNAUTHENTICATED', 'Please sign in to continue.', {
      context: { reason: 'session_claims_malformed' },
    });
  }

  return { sub, sid, roles, tok, aud_surface: surface, exp };
}

/**
 * Reads routing claims WITHOUT a database round trip, for middleware.
 *
 * Returns null instead of throwing because middleware's only sensible response to a
 * bad cookie is to redirect to sign-in, not to render an error.
 */
export async function readSessionClaimsForRouting(
  cookieValue: string | undefined,
  secretOverride?: string | undefined
): Promise<{ userId: string; sessionId: string; roles: string[]; surface: string } | null> {
  if (!cookieValue) return null;

  try {
    const verified = await verifySessionToken(cookieValue, secretOverride);
    return {
      userId: verified.userId,
      sessionId: verified.sessionId,
      roles: verified.roles,
      surface: verified.surface,
    };
  } catch {
    return null;
  }
}
