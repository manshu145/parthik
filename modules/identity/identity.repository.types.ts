import type { Locale } from '@/i18n/routing';
import type { RoleKey } from './permissions';

/**
 * Identity repository contract.
 *
 * The service depends on this interface and never on Drizzle types, which is what
 * lets the whole authentication and RBAC path be unit-tested without a database —
 * important both while the managed Postgres provider is unchosen (D-01a) and
 * because security-critical logic deserves exhaustive tests rather than the handful
 * a live database makes convenient.
 */

export type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';

export type RoleScopeType = 'GLOBAL' | 'VENDOR' | 'STORE';

/**
 * One live role grant.
 *
 * `scopeType`/`scopeId` is what makes vendor staff possible: the same VENDOR_STAFF
 * role granted against different vendors. A GLOBAL grant carries a null scope.
 */
export interface RoleGrant {
  roleKey: RoleKey;
  scopeType: RoleScopeType;
  scopeId: string | null;
}

export interface UserRecord {
  id: string;
  firebaseUid: string;
  phone: string | null;
  phoneVerifiedAt: Date | null;
  email: string | null;
  fullName: string | null;
  preferredLocale: Locale;
  status: UserStatus;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
  anonymizedAt: Date | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  activeRoleId: string | null;
  expiresAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
}

/** Everything the service needs to authorize a request, in one round trip. */
export interface SessionWithUser {
  session: SessionRecord;
  user: UserRecord;
  roles: RoleGrant[];
}

export interface CreateUserInput {
  firebaseUid: string;
  /** Taken from the VERIFIED Firebase token only, never from a request body. */
  phone: string;
  phoneVerifiedAt: Date;
  email?: string | undefined;
  preferredLocale: Locale;
}

export interface CreateSessionInput {
  /**
   * Supplied by the service rather than defaulted by the database.
   *
   * The cookie must carry the session id and the row must carry the cookie's hash —
   * a mutual reference. Generating the id up front lets the token be signed before
   * the insert, so the session is created in ONE statement with both halves already
   * consistent. The alternative (insert, sign, update) leaves a row that briefly
   * cannot be resolved, and orphans it entirely if the second write fails.
   */
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  firebaseTokenIssuedAt: Date | null;
  ipHash: string | null;
  userAgent: string | null;
}

export interface LoginAttemptInput {
  /** Null on failure: a rejected token yields no trustworthy identifier. */
  identifier: string | null;
  identifierType: 'FIREBASE_UID' | 'PHONE' | 'IP' | null;
  ipHash: string | null;
  success: boolean;
  failureReason: string | null;
  userAgent: string | null;
}

export interface IdentityRepository {
  // ---- Users ----

  /** Primary lookup on every sign-in (unique index `users_firebase_uid_key`). */
  findUserByFirebaseUid(firebaseUid: string): Promise<UserRecord | null>;

  findUserById(userId: string): Promise<UserRecord | null>;

  /**
   * Creates a user and grants the default CUSTOMER role in ONE transaction.
   *
   * Atomic on purpose: a user row without a role is an account that can sign in and
   * then do nothing, which is a confusing state to debug and an easy one to create
   * if a second statement fails.
   */
  createUserWithDefaultRole(input: CreateUserInput): Promise<UserRecord>;

  /** Mirrors verified contact details and stamps `last_login_at`. */
  recordSuccessfulLogin(input: {
    userId: string;
    phone: string;
    phoneVerifiedAt: Date;
    email?: string | undefined;
    at: Date;
  }): Promise<void>;

  // ---- Roles ----

  /** Live grants only — rows with `revoked_at IS NULL`. */
  listRoleGrants(userId: string): Promise<RoleGrant[]>;

  // ---- Sessions ----

  createSession(input: CreateSessionInput): Promise<SessionRecord>;

  /**
   * Points an existing session at a NEW cookie hash, for rolling renewal.
   *
   * The hash is replaced rather than added: a session has exactly one live cookie, so
   * a renewed cookie must invalidate the one it replaces. Keeping both would mean a
   * stolen cookie survives the renewal that was supposed to rotate it.
   */
  rotateSessionToken(sessionId: string, tokenHash: string, expiresAt: Date): Promise<void>;

  /**
   * Loads a session with its user and roles by token hash.
   *
   * Returns rows regardless of revocation or expiry; the SERVICE decides validity,
   * so the reason a session was refused can be logged and distinguished (revoked vs
   * expired vs banned user) rather than collapsing into "not found".
   */
  findSessionByTokenHash(tokenHash: string): Promise<SessionWithUser | null>;

  /** Advances `last_seen_at`, which drives the admin idle timeout. */
  touchSession(sessionId: string, at: Date): Promise<void>;

  revokeSession(sessionId: string, reason: string, at: Date): Promise<void>;

  /** "Log out everywhere", and the required effect of a ban or role change (D-10). */
  revokeAllSessionsForUser(userId: string, reason: string, at: Date): Promise<number>;

  // ---- Abuse signals ----

  recordLoginAttempt(input: LoginAttemptInput): Promise<void>;

  /**
   * Failed exchanges from one IP since a timestamp.
   *
   * Keyed on IP because a REJECTED token gives no reliable identity to key on
   * (docs/SECURITY.md §2.4).
   */
  countRecentFailedAttempts(ipHash: string, since: Date): Promise<number>;
}
