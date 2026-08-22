import type { Locale } from '@/i18n/routing';
import { fixtureId } from '@/lib/db/fixture-id';
import type {
  CreateSessionInput,
  CreateUserInput,
  IdentityRepository,
  LoginAttemptInput,
  RoleGrant,
  SessionRecord,
  SessionWithUser,
  UserRecord,
} from './identity.repository.types';
import type { RoleKey } from './permissions';

/**
 * In-memory identity repository.
 *
 * Purpose is narrower than the other memory repositories in this codebase. Those
 * exist so a fresh clone can browse a catalogue without a database. This one exists
 * so the authentication and RBAC logic can be TESTED exhaustively — forged tokens,
 * revoked sessions, idle timeouts, scoped vendor permissions, role changes
 * mid-session — none of which is convenient to set up against live Postgres, and all
 * of which is security-critical enough to deserve a test each.
 *
 * It is never selected in production: the composition root forces `postgres` there
 * (see index.ts), because serving sessions from process memory would silently sign
 * every visitor out on each deploy and isolate.
 */

/** Seeded so a credential-free environment has predictable actors to sign in as. */
export interface SeedUser {
  firebaseUid: string;
  phone: string;
  fullName?: string;
  roles: Array<{ roleKey: RoleKey; scopeType?: 'GLOBAL' | 'VENDOR' | 'STORE'; scopeId?: string }>;
  status?: UserRecord['status'];
  preferredLocale?: Locale;
}

export const DEMO_VENDOR_SCOPE_ID = fixtureId('vendor', 'demo-vendor');
export const DEMO_STORE_SCOPE_ID = fixtureId('store', 'demo-store');

/**
 * Demo actors, mirroring the roles in db/seed/dev-data.ts so a developer signing in
 * against the Auth Emulator lands on the surface they expect.
 */
export const DEMO_USERS: readonly SeedUser[] = [
  {
    firebaseUid: 'demo-customer-uid',
    phone: '+919000000001',
    fullName: 'Demo Customer',
    roles: [{ roleKey: 'CUSTOMER' }],
  },
  {
    firebaseUid: 'demo-vendor-uid',
    phone: '+919000000002',
    fullName: 'Demo Vendor Owner',
    roles: [
      { roleKey: 'CUSTOMER' },
      { roleKey: 'VENDOR_OWNER', scopeType: 'VENDOR', scopeId: DEMO_VENDOR_SCOPE_ID },
    ],
  },
  {
    firebaseUid: 'demo-driver-uid',
    phone: '+919000000003',
    fullName: 'Demo Driver',
    roles: [{ roleKey: 'CUSTOMER' }, { roleKey: 'DRIVER' }],
  },
  {
    firebaseUid: 'demo-admin-uid',
    phone: '+919000000004',
    fullName: 'Demo Super Admin',
    roles: [{ roleKey: 'CUSTOMER' }, { roleKey: 'SUPER_ADMIN' }],
  },
];

interface StoredUser extends UserRecord {
  roles: RoleGrant[];
}

interface StoredAttempt {
  ipHash: string | null;
  success: boolean;
  createdAt: Date;
}

export class InMemoryIdentityRepository implements IdentityRepository {
  private readonly users = new Map<string, StoredUser>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly attempts: StoredAttempt[] = [];

  constructor(seed: readonly SeedUser[] = DEMO_USERS) {
    for (const user of seed) this.seedUser(user);
  }

  private seedUser(seed: SeedUser): void {
    const id = fixtureId('user', seed.firebaseUid);
    this.users.set(id, {
      id,
      firebaseUid: seed.firebaseUid,
      phone: seed.phone,
      phoneVerifiedAt: new Date('2026-01-01T00:00:00Z'),
      email: null,
      fullName: seed.fullName ?? null,
      preferredLocale: seed.preferredLocale ?? 'en',
      status: seed.status ?? 'ACTIVE',
      lastLoginAt: null,
      deletedAt: null,
      anonymizedAt: null,
      roles: seed.roles.map((role) => ({
        roleKey: role.roleKey,
        scopeType: role.scopeType ?? 'GLOBAL',
        scopeId: role.scopeId ?? null,
      })),
    });
  }

  // ---- Users ----

  async findUserByFirebaseUid(firebaseUid: string): Promise<UserRecord | null> {
    for (const user of this.users.values()) {
      if (user.firebaseUid === firebaseUid) return stripRoles(user);
    }
    return null;
  }

  async findUserById(userId: string): Promise<UserRecord | null> {
    const user = this.users.get(userId);
    return user ? stripRoles(user) : null;
  }

  async createUserWithDefaultRole(input: CreateUserInput): Promise<UserRecord> {
    const id = fixtureId('user', input.firebaseUid);

    const user: StoredUser = {
      id,
      firebaseUid: input.firebaseUid,
      phone: input.phone,
      phoneVerifiedAt: input.phoneVerifiedAt,
      email: input.email ?? null,
      fullName: null,
      preferredLocale: input.preferredLocale,
      status: 'ACTIVE',
      lastLoginAt: null,
      deletedAt: null,
      anonymizedAt: null,
      // Every new account is a CUSTOMER and nothing more. Elevated roles are always
      // granted deliberately by an admin, never inferred at sign-up.
      roles: [{ roleKey: 'CUSTOMER', scopeType: 'GLOBAL', scopeId: null }],
    };

    this.users.set(id, user);
    return stripRoles(user);
  }

  async recordSuccessfulLogin(input: {
    userId: string;
    phone: string;
    phoneVerifiedAt: Date;
    email?: string | undefined;
    at: Date;
  }): Promise<void> {
    const user = this.users.get(input.userId);
    if (!user) return;

    user.phone = input.phone;
    user.phoneVerifiedAt = input.phoneVerifiedAt;
    if (input.email) user.email = input.email;
    user.lastLoginAt = input.at;
  }

  // ---- Roles ----

  async listRoleGrants(userId: string): Promise<RoleGrant[]> {
    return this.users.get(userId)?.roles.map((grant) => ({ ...grant })) ?? [];
  }

  /** Test helper: grants a role mid-session, to exercise cookie-claim staleness. */
  grantRoleForTests(userId: string, grant: RoleGrant): void {
    this.users.get(userId)?.roles.push(grant);
  }

  /** Test helper: changes account status, to exercise ban and suspension paths. */
  setStatusForTests(userId: string, status: UserRecord['status']): void {
    const user = this.users.get(userId);
    if (user) user.status = status;
  }

  // ---- Sessions ----

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      activeRoleId: null,
      expiresAt: input.expiresAt,
      lastSeenAt: null,
      revokedAt: null,
      revokedReason: null,
      createdAt: new Date(),
    };

    this.sessions.set(session.id, session);
    return { ...session };
  }

  async rotateSessionToken(sessionId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.tokenHash = tokenHash;
    session.expiresAt = expiresAt;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
    for (const session of this.sessions.values()) {
      if (session.tokenHash !== tokenHash) continue;

      const user = this.users.get(session.userId);
      if (!user) return null;

      return {
        session: { ...session },
        user: stripRoles(user),
        roles: user.roles.map((grant) => ({ ...grant })),
      };
    }
    return null;
  }

  async touchSession(sessionId: string, at: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) session.lastSeenAt = at;
  }

  async revokeSession(sessionId: string, reason: string, at: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt) return;
    session.revokedAt = at;
    session.revokedReason = reason;
  }

  async revokeAllSessionsForUser(userId: string, reason: string, at: Date): Promise<number> {
    let revoked = 0;
    for (const session of this.sessions.values()) {
      if (session.userId !== userId || session.revokedAt) continue;
      session.revokedAt = at;
      session.revokedReason = reason;
      revoked += 1;
    }
    return revoked;
  }

  /** Test helper: forces an idle timeout without waiting 30 minutes. */
  setLastSeenForTests(sessionId: string, at: Date): void {
    const session = this.sessions.get(sessionId);
    if (session) session.lastSeenAt = at;
  }

  /** Test helper: expires a session without waiting out its lifetime. */
  setExpiryForTests(sessionId: string, at: Date): void {
    const session = this.sessions.get(sessionId);
    if (session) session.expiresAt = at;
  }

  // ---- Abuse signals ----

  async recordLoginAttempt(input: LoginAttemptInput): Promise<void> {
    this.attempts.push({
      ipHash: input.ipHash,
      success: input.success,
      createdAt: new Date(),
    });
  }

  async countRecentFailedAttempts(ipHash: string, since: Date): Promise<number> {
    return this.attempts.filter(
      (attempt) =>
        !attempt.success &&
        attempt.ipHash === ipHash &&
        attempt.createdAt.getTime() >= since.getTime()
    ).length;
  }

  /** Test helper: pre-loads failures to exercise the throttle. */
  seedFailedAttemptsForTests(ipHash: string, count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.attempts.push({ ipHash, success: false, createdAt: new Date() });
    }
  }
}

/** Roles are exposed through `listRoleGrants`, so they never ride along on the user. */
function stripRoles(user: StoredUser): UserRecord {
  const { roles: _roles, ...record } = user;
  return { ...record };
}

/** Demo phone numbers, for the diagnostics endpoint. */
export function inMemoryDemoPhones(): string[] {
  return DEMO_USERS.map((user) => user.phone);
}
