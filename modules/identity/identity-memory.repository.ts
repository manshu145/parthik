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
import { DEMO_PERSONAS } from './demo-personas';
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
 * Demo actors, DERIVED from the canonical persona list rather than declared again.
 *
 * Previously this held its own uids (`demo-admin-uid`, …) while the database seed used
 * different ones, so the development sign-in endpoint worked against this backend and
 * failed against a real database. Deriving both from one declaration removes the
 * possibility; `tests/unit/demo-personas.test.ts` asserts they still agree.
 */
export const DEMO_USERS: readonly SeedUser[] = DEMO_PERSONAS.map((persona) => ({
  firebaseUid: persona.firebaseUid,
  phone: persona.phone,
  fullName: persona.fullName,
  preferredLocale: persona.preferredLocale,
  roles: persona.roles.map((role) =>
    role.scope === 'DEMO_VENDOR'
      ? { roleKey: role.roleKey, scopeType: 'VENDOR' as const, scopeId: DEMO_VENDOR_SCOPE_ID }
      : { roleKey: role.roleKey, scopeType: 'GLOBAL' as const }
  ),
}));

interface StoredUser extends UserRecord {
  roles: RoleGrant[];
}

interface StoredAttempt {
  ipHash: string | null;
  success: boolean;
  createdAt: Date;
}

/**
 * The backing store, held at MODULE level.
 *
 * This is the one place the identity memory repository must differ from the
 * catalogue/location/search ones. Those serve read-only fixtures, so a fresh instance
 * per request is harmless. Identity WRITES — sessions are created on sign-in and read
 * on every subsequent request — and the composition root builds a new repository for
 * each call. With per-instance state a session vanished the moment the request that
 * created it ended, so sign-in appeared to succeed and every following page reported
 * the user as anonymous.
 *
 * Sharing the store makes it behave like a real store for the lifetime of the process,
 * which is what the code under test actually depends on.
 */
export interface IdentityStore {
  users: Map<string, StoredUser>;
  sessions: Map<string, SessionRecord>;
  attempts: StoredAttempt[];
}

/**
 * The shared store hangs off `globalThis`, NOT a module-level `let`.
 *
 * Next.js compiles route handlers and server components into SEPARATE module graphs,
 * so a module-level singleton is instantiated once PER GRAPH. A session written by
 * `POST /api/v1/auth/dev-session` (a route handler) was therefore invisible to the
 * admin page that rendered next (a server component): sign-in returned 201 and set a
 * valid cookie, and every page still reported the visitor as anonymous.
 *
 * `globalThis` is shared across both graphs within the process, which is the only
 * place this state can live and be seen by both. Same reasoning as the well-known
 * database-client singleton pattern, and it is dev-only either way — production always
 * resolves to Postgres.
 */
const STORE_KEY = '__parthikIdentityStore';

type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: IdentityStore };

function readSharedStore(): IdentityStore | undefined {
  return (globalThis as GlobalWithStore)[STORE_KEY];
}

function writeSharedStore(store: IdentityStore): void {
  (globalThis as GlobalWithStore)[STORE_KEY] = store;
}

function createStore(seed: readonly SeedUser[]): IdentityStore {
  const store: IdentityStore = { users: new Map(), sessions: new Map(), attempts: [] };

  for (const user of seed) {
    const id = fixtureId('user', user.firebaseUid);
    store.users.set(id, {
      id,
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      phoneVerifiedAt: new Date('2026-01-01T00:00:00Z'),
      email: null,
      fullName: user.fullName ?? null,
      preferredLocale: user.preferredLocale ?? 'en',
      status: user.status ?? 'ACTIVE',
      lastLoginAt: null,
      deletedAt: null,
      anonymizedAt: null,
      roles: user.roles.map((role) => ({
        roleKey: role.roleKey,
        scopeType: role.scopeType ?? 'GLOBAL',
        scopeId: role.scopeId ?? null,
      })),
    });
  }

  return store;
}

/** An independent store, so a test cannot be affected by another test's writes. */
export function createIsolatedIdentityStore(seed: readonly SeedUser[] = DEMO_USERS): IdentityStore {
  return createStore(seed);
}

/** Test-only: drops the shared store so state does not leak between suites. */
export function resetSharedIdentityStoreForTests(): void {
  delete (globalThis as GlobalWithStore)[STORE_KEY];
}

export interface InMemoryIdentityRepositoryOptions {
  /**
   * Use a private store rather than the shared one.
   *
   * Tests should set this. Anything relying on cross-request persistence (the running
   * application) must not.
   */
  isolated?: boolean;
  seed?: readonly SeedUser[];
  store?: IdentityStore;
}

export class InMemoryIdentityRepository implements IdentityRepository {
  private readonly store: IdentityStore;

  constructor(options: InMemoryIdentityRepositoryOptions = {}) {
    if (options.store) {
      this.store = options.store;
    } else if (options.isolated) {
      this.store = createStore(options.seed ?? DEMO_USERS);
    } else {
      const existing = readSharedStore();
      if (existing) {
        this.store = existing;
      } else {
        this.store = createStore(options.seed ?? DEMO_USERS);
        writeSharedStore(this.store);
      }
    }
  }

  private get users(): Map<string, StoredUser> {
    return this.store.users;
  }

  private get sessions(): Map<string, SessionRecord> {
    return this.store.sessions;
  }

  private get attempts(): StoredAttempt[] {
    return this.store.attempts;
  }

  /** Adds a user after construction, for tests that need a specific fixture. */
  seedUserForTests(seed: SeedUser): string {
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
    return id;
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
