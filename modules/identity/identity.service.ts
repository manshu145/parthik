import type { Locale } from '@/i18n/routing';
import {
  issueSessionToken,
  verifySessionToken,
  type IssuedSessionToken,
} from '@/lib/auth/session-token';
import {
  ADMIN_IDLE_TIMEOUT_SECONDS,
  SESSION_LIFETIMES_SECONDS,
  type SessionAudience,
} from '@/lib/auth/session-cookie';
import { AuthenticationError, AuthorizationError, RateLimitError } from '@/lib/errors';
import { homePathForSurface } from '@/lib/http/route-access';
import { logger } from '@/lib/logger';
import { verifyFirebaseIdToken, type VerifiedFirebaseToken } from '@/lib/firebase/verify-id-token';
import type { IdentityRepository, RoleGrant, UserRecord } from './identity.repository.types';
import {
  buildActor,
  landingSurfaceForRoles,
  roleKeysFor,
  sessionAudienceForRoles,
  type Actor,
} from './identity.policy';

/**
 * Identity service — the Firebase→Parthik boundary (docs/ARCHITECTURE.md §11.1).
 *
 * THE SPLIT THIS CLASS ENFORCES: Firebase is authoritative at the MOMENT of
 * authentication; Parthik is authoritative for everything afterwards. Firebase says
 * "this phone number proved it controls this handset"; Parthik decides who that is,
 * what they may do, and for how long.
 *
 * Consequently: roles are never read from Firebase custom claims, the Firebase ID
 * token is never used as a session, and it is never retained.
 */

/** How many failed exchanges from one IP before it is throttled. */
const MAX_FAILED_EXCHANGES_PER_IP = 10;

/** Window for the failure count. */
const FAILED_EXCHANGE_WINDOW_SECONDS = 15 * 60;

/** Backoff advertised in `Retry-After` once throttled. */
const EXCHANGE_RETRY_AFTER_SECONDS = 15 * 60;

/**
 * How stale `last_seen_at` may get before we write it again.
 *
 * Without this, every authenticated request would issue an UPDATE purely to record
 * activity — a write on every page view, for a value only the idle timeout reads.
 */
const SESSION_TOUCH_INTERVAL_SECONDS = 60;

export interface SessionContext {
  actor: Actor;
  /**
   * Which lifetime band this session belongs to.
   *
   * Returned rather than left for the caller to infer from role names: a route
   * handler guessing "does any role start with ADMIN" would silently give an
   * ADMIN_FINANCE user a 30-day cookie the moment a role was renamed.
   */
  audience: SessionAudience;
  /** Set when the session should be refreshed on the response. */
  renewedCookie?: IssuedSessionToken | undefined;
}

export interface ExchangeResult {
  actor: Actor;
  token: IssuedSessionToken;
  audience: SessionAudience;
  /** Where the client should navigate after sign-in. */
  landingPath: string;
  /** True when this sign-in created the account. */
  isNewUser: boolean;
}

export interface RequestFingerprint {
  ipHash: string | null;
  userAgent: string | null;
}

export class IdentityService {
  private readonly repository: IdentityRepository;

  constructor(dependencies: { repository: IdentityRepository }) {
    this.repository = dependencies.repository;
  }

  /**
   * Exchanges a verified Firebase ID token for a Parthik session.
   *
   * The order of operations is deliberate and security-relevant:
   *   1. throttle by IP, BEFORE any expensive verification
   *   2. verify the token — nothing downstream trusts the request body
   *   3. find or create the user, keyed on the token's uid
   *   4. refuse suspended/banned/deleted accounts
   *   5. issue a session whose lifetime reflects the user's most privileged role
   */
  async exchangeFirebaseToken(input: {
    idToken: string;
    locale?: Locale | undefined;
    fingerprint: RequestFingerprint;
  }): Promise<ExchangeResult> {
    await this.assertExchangeNotThrottled(input.fingerprint.ipHash);

    let verified: VerifiedFirebaseToken;
    try {
      verified = await verifyFirebaseIdToken(input.idToken);
    } catch (error) {
      // Recorded against the IP only: a rejected token yields no identifier we are
      // entitled to believe.
      await this.repository.recordLoginAttempt({
        identifier: null,
        identifierType: 'IP',
        ipHash: input.fingerprint.ipHash,
        success: false,
        failureReason: error instanceof Error ? error.name : 'token_rejected',
        userAgent: input.fingerprint.userAgent,
      });
      throw error;
    }

    const { user, isNewUser } = await this.findOrCreateUser(verified, input.locale);

    // Checked after the user is resolved so a ban is recorded against a real
    // identity, and so a banned user's attempts remain visible in login_attempts.
    this.assertUserMaySignIn(user, verified, input.fingerprint);

    const roles = await this.repository.listRoleGrants(user.id);
    const roleKeys = roles.map((grant) => grant.roleKey);
    const audience = sessionAudienceForRoles(roleKeys);

    // Generated here, not defaulted by the database, so the token can be signed
    // before the insert and the session created in one consistent statement.
    const sessionId = crypto.randomUUID();

    const token = await issueSessionToken({
      userId: user.id,
      sessionId,
      roles: roleKeys,
      surface: audience,
      lifetimeSeconds: SESSION_LIFETIMES_SECONDS[audience],
    });

    const session = await this.repository.createSession({
      id: sessionId,
      userId: user.id,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      firebaseTokenIssuedAt: new Date(verified.issuedAt * 1000),
      ipHash: input.fingerprint.ipHash,
      userAgent: input.fingerprint.userAgent,
    });

    await this.repository.recordSuccessfulLogin({
      userId: user.id,
      phone: verified.phoneNumber,
      phoneVerifiedAt: new Date(verified.authTime * 1000),
      email: verified.email,
      at: new Date(),
    });

    await this.repository.recordLoginAttempt({
      identifier: verified.uid,
      identifierType: 'FIREBASE_UID',
      ipHash: input.fingerprint.ipHash,
      success: true,
      failureReason: null,
      userAgent: input.fingerprint.userAgent,
    });

    const actor = buildActor({ userId: user.id, sessionId: session.id, user, roles });

    logger.info('Session issued', {
      userId: user.id,
      sessionId: session.id,
      audience,
      isNewUser,
      roles: roleKeys,
    });

    return {
      actor,
      token,
      audience,
      landingPath: homePathForSurface(landingSurfaceForRoles(roleKeys)),
      isNewUser,
    };
  }

  /**
   * Resolves the actor for a request from its session cookie.
   *
   * This is the function every authorization decision ultimately depends on, and it
   * deliberately re-reads the DATABASE rather than trusting the cookie's claims. The
   * cookie proves the session was issued by us; only the database knows whether it
   * is still live, whether the user was banned an hour ago, or whether their roles
   * changed.
   *
   * Returns null for "not signed in" and THROWS for "was signed in, no longer
   * valid", because those need different responses: the first renders a public page,
   * the second must clear the cookie and explain why.
   */
  async resolveSession(cookieValue: string | undefined): Promise<SessionContext | null> {
    if (!cookieValue) return null;

    const verified = await verifySessionToken(cookieValue);
    const found = await this.repository.findSessionByTokenHash(verified.tokenHash);

    if (!found) {
      // Signature valid but no matching row: the session was deleted, or the cookie
      // was signed with a key that no longer maps to stored state.
      throw new AuthenticationError('SESSION_EXPIRED', 'Your session has ended. Please sign in.', {
        context: { reason: 'session_not_found', sessionId: verified.sessionId },
      });
    }

    const { session, user, roles } = found;
    const now = new Date();

    if (session.revokedAt) {
      throw new AuthenticationError('SESSION_EXPIRED', 'Your session has ended. Please sign in.', {
        context: { reason: 'session_revoked', revokedReason: session.revokedReason },
      });
    }

    if (session.expiresAt.getTime() <= now.getTime()) {
      throw new AuthenticationError(
        'SESSION_EXPIRED',
        'Your session has expired. Please sign in again.',
        { context: { reason: 'session_expired' } }
      );
    }

    this.assertUserMayUseSession(user);

    const audience = sessionAudienceForRoles(roles.map((grant) => grant.roleKey));

    // Admin sessions additionally expire on inactivity (D-10). Enforced from
    // last_seen_at rather than from the cookie, so it cannot be evaded by holding a
    // cookie and replaying it later.
    if (audience === 'admin' && this.isIdleTimedOut(session.lastSeenAt ?? session.createdAt, now)) {
      await this.repository.revokeSession(session.id, 'idle_timeout', now);
      throw new AuthenticationError(
        'SESSION_EXPIRED',
        'You were signed out after a period of inactivity.',
        { context: { reason: 'idle_timeout' } }
      );
    }

    if (this.shouldTouch(session.lastSeenAt, now)) {
      await this.repository.touchSession(session.id, now);
    }

    const actor = buildActor({ userId: user.id, sessionId: session.id, user, roles });

    // Customer sessions are rolling (D-10): activity extends them. Re-issued only
    // when the roles in the cookie have gone stale or the window is past halfway, so
    // this is not a new Set-Cookie on every request.
    const renewedCookie = await this.maybeRenew({
      session,
      actor,
      audience,
      cookieRoles: verified.roles,
      now,
    });

    return { actor, audience, ...(renewedCookie ? { renewedCookie } : {}) };
  }

  /** Signs the caller out. `allDevices` revokes every session they hold. */
  async revokeSession(input: {
    cookieValue: string | undefined;
    allDevices: boolean;
  }): Promise<{ revoked: number }> {
    if (!input.cookieValue) return { revoked: 0 };

    const now = new Date();

    // A cookie we cannot verify is already useless, so sign-out succeeds rather than
    // erroring — the caller's intent is satisfied by clearing it.
    let tokenHash: string;
    let userId: string;
    try {
      const verified = await verifySessionToken(input.cookieValue);
      tokenHash = verified.tokenHash;
      userId = verified.userId;
    } catch {
      return { revoked: 0 };
    }

    if (input.allDevices) {
      const revoked = await this.repository.revokeAllSessionsForUser(
        userId,
        'user_logout_all',
        now
      );
      logger.info('All sessions revoked', { userId, revoked });
      return { revoked };
    }

    const found = await this.repository.findSessionByTokenHash(tokenHash);
    if (!found || found.session.revokedAt) return { revoked: 0 };

    await this.repository.revokeSession(found.session.id, 'user_logout', now);
    logger.info('Session revoked', { userId, sessionId: found.session.id });
    return { revoked: 1 };
  }

  /** Revokes every session for a user. Used by ban, suspend and role change (D-10). */
  async revokeAllSessions(userId: string, reason: string): Promise<number> {
    return this.repository.revokeAllSessionsForUser(userId, reason, new Date());
  }

  /**
   * Issues a session for an EXISTING user without a Firebase token.
   *
   * Used only by `POST /api/v1/auth/dev-session`, which is 404 in production and
   * requires an explicit opt-in. The caller owns that gating; this method deliberately
   * enforces none of it, because a security control split across two places is a
   * control that gets half-checked.
   *
   * What it does enforce is that it CANNOT CREATE a user. It returns null for an
   * unknown uid rather than provisioning one, so the endpoint can never be used to
   * conjure an account — only to sign in as an already-seeded demo identity.
   */
  async createDevelopmentSession(input: {
    firebaseUid: string;
    fingerprint: RequestFingerprint;
  }): Promise<ExchangeResult | null> {
    const user = await this.repository.findUserByFirebaseUid(input.firebaseUid);
    if (!user || user.status !== 'ACTIVE') return null;

    const roles = await this.repository.listRoleGrants(user.id);
    const roleKeys = roles.map((grant) => grant.roleKey);
    const audience = sessionAudienceForRoles(roleKeys);

    // The same issue-then-insert path as the real exchange, so this exercises the
    // production session mechanism rather than a parallel one that could drift.
    const sessionId = crypto.randomUUID();
    const token = await issueSessionToken({
      userId: user.id,
      sessionId,
      roles: roleKeys,
      surface: audience,
      lifetimeSeconds: SESSION_LIFETIMES_SECONDS[audience],
    });

    const session = await this.repository.createSession({
      id: sessionId,
      userId: user.id,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      firebaseTokenIssuedAt: null,
      ipHash: input.fingerprint.ipHash,
      userAgent: input.fingerprint.userAgent,
    });

    return {
      actor: buildActor({ userId: user.id, sessionId: session.id, user, roles }),
      token,
      audience,
      landingPath: homePathForSurface(landingSurfaceForRoles(roleKeys)),
      isNewUser: false,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async findOrCreateUser(
    verified: VerifiedFirebaseToken,
    locale: Locale | undefined
  ): Promise<{ user: UserRecord; isNewUser: boolean }> {
    const existing = await this.repository.findUserByFirebaseUid(verified.uid);
    if (existing) return { user: existing, isNewUser: false };

    const created = await this.repository.createUserWithDefaultRole({
      firebaseUid: verified.uid,
      // From the token, never the request body.
      phone: verified.phoneNumber,
      phoneVerifiedAt: new Date(verified.authTime * 1000),
      email: verified.email,
      preferredLocale: locale ?? 'en',
    });

    logger.info('User created from first sign-in', { userId: created.id });
    return { user: created, isNewUser: true };
  }

  /**
   * Rejects accounts that must not receive a session.
   *
   * SUSPENDED and BANNED are distinguished in logs but produce the same opaque
   * message — telling someone which of the two applies is information they can use
   * to evade it.
   */
  private assertUserMaySignIn(
    user: UserRecord,
    verified: VerifiedFirebaseToken,
    fingerprint: RequestFingerprint
  ): void {
    if (user.status === 'ACTIVE') return;

    void this.repository.recordLoginAttempt({
      identifier: verified.uid,
      identifierType: 'FIREBASE_UID',
      ipHash: fingerprint.ipHash,
      success: false,
      failureReason: `status:${user.status}`,
      userAgent: fingerprint.userAgent,
    });

    logger.warn('Sign-in refused for a non-active account', {
      userId: user.id,
      status: user.status,
    });

    throw new AuthorizationError(
      'ACCOUNT_SUSPENDED',
      'This account cannot be used to sign in. Please contact support.',
      { context: { userId: user.id, status: user.status } }
    );
  }

  private assertUserMayUseSession(user: UserRecord): void {
    if (user.status === 'ACTIVE' && !user.deletedAt && !user.anonymizedAt) return;

    throw new AuthorizationError('ACCOUNT_SUSPENDED', 'This account is not active.', {
      context: { userId: user.id, status: user.status },
    });
  }

  private async assertExchangeNotThrottled(ipHash: string | null): Promise<void> {
    // With no usable IP there is nothing to key a limit on. The edge rate limit and
    // Firebase's own reCAPTCHA still apply, so this is a degraded control, not none.
    if (!ipHash) return;

    const since = new Date(Date.now() - FAILED_EXCHANGE_WINDOW_SECONDS * 1000);
    const failures = await this.repository.countRecentFailedAttempts(ipHash, since);

    if (failures >= MAX_FAILED_EXCHANGES_PER_IP) {
      logger.warn('Token exchange throttled', { failures });
      throw new RateLimitError(EXCHANGE_RETRY_AFTER_SECONDS, {
        context: { reason: 'failed_exchange_limit', failures },
      });
    }
  }

  private isIdleTimedOut(lastSeenAt: Date, now: Date): boolean {
    const idleSeconds = (now.getTime() - lastSeenAt.getTime()) / 1000;
    return idleSeconds > ADMIN_IDLE_TIMEOUT_SECONDS;
  }

  private shouldTouch(lastSeenAt: Date | null, now: Date): boolean {
    if (!lastSeenAt) return true;
    return (now.getTime() - lastSeenAt.getTime()) / 1000 >= SESSION_TOUCH_INTERVAL_SECONDS;
  }

  /**
   * Decides whether to re-issue the cookie.
   *
   * Two triggers:
   *   - the cookie's roles no longer match the database, so middleware would keep
   *     routing on stale claims (a user promoted to admin would never see the admin
   *     nav until they signed out)
   *   - the session is past halfway through its life, giving rolling sessions for
   *     active users without a Set-Cookie on every request
   */
  private async maybeRenew(input: {
    session: { id: string; expiresAt: Date; createdAt: Date };
    actor: Actor;
    audience: SessionAudience;
    cookieRoles: string[];
    now: Date;
  }): Promise<IssuedSessionToken | undefined> {
    const currentRoles = roleKeysFor(input.actor);
    const rolesChanged = !sameMembers(currentRoles, input.cookieRoles);

    const lifetimeMs = SESSION_LIFETIMES_SECONDS[input.audience] * 1000;
    const remainingMs = input.session.expiresAt.getTime() - input.now.getTime();
    const pastHalfLife = remainingMs < lifetimeMs / 2;

    if (!rolesChanged && !pastHalfLife) return undefined;

    const token = await issueSessionToken({
      userId: input.actor.userId,
      sessionId: input.session.id,
      roles: currentRoles,
      surface: input.audience,
      lifetimeSeconds: SESSION_LIFETIMES_SECONDS[input.audience],
    });

    // The row must track the new hash or the refreshed cookie would not resolve.
    await this.repository.rotateSessionToken(input.session.id, token.tokenHash, token.expiresAt);

    logger.debug('Session cookie renewed', {
      userId: input.actor.userId,
      sessionId: input.session.id,
      reason: rolesChanged ? 'roles_changed' : 'rolling_extension',
    });

    return token;
  }
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((value) => setB.has(value));
}

export type { Actor, RoleGrant };
