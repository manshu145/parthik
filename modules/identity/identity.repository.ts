import { and, count, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  loginAttempts,
  permissions as permissionRows,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from '@/db/schema';
import type { Database } from '@/lib/db/client';
import type { RepositoryContext } from '@/lib/db/repository';
import { ConflictError } from '@/lib/errors';
import type { Locale } from '@/i18n/routing';
import type {
  CreateSessionInput,
  CreateUserInput,
  IdentityRepository,
  LoginAttemptInput,
  RoleGrant,
  RoleScopeType,
  SessionRecord,
  SessionWithUser,
  UserRecord,
  UserStatus,
} from './identity.repository.types';
import { isPermissionKey, isRoleKey, type PermissionKey, type RoleKey } from './permissions';

/**
 * Drizzle identity repository — the only place identity tables are touched.
 *
 * Two things here are deliberately different from the other repositories:
 *
 *   1. Role reads JOIN `user_roles → roles` and filter `revoked_at IS NULL` in the
 *      QUERY, not in application code. A revoked grant must be impossible to return,
 *      not merely filtered out by a caller who remembers to.
 *
 *   2. `firebase_uid` is only ever a lookup key or written from a verified token. It
 *      is never accepted from a request, which is enforced by the fact that no method
 *      here takes it as an updatable field.
 */
export class DrizzleIdentityRepository implements IdentityRepository {
  private readonly db: Database;

  constructor(context: RepositoryContext) {
    this.db = context.db;
  }

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  async findUserByFirebaseUid(firebaseUid: string): Promise<UserRecord | null> {
    const [row] = await this.db
      .select(userColumns)
      .from(users)
      .where(and(eq(users.firebaseUid, firebaseUid), isNull(users.deletedAt)))
      .limit(1);

    return row ? mapUser(row) : null;
  }

  async findUserById(userId: string): Promise<UserRecord | null> {
    const [row] = await this.db
      .select(userColumns)
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    return row ? mapUser(row) : null;
  }

  /**
   * Creates the user and its default CUSTOMER grant atomically.
   *
   * A transaction rather than two statements: a user row with no role can sign in and
   * then do nothing at all, and that state is both confusing to diagnose and easy to
   * produce if the second insert fails.
   */
  async createUserWithDefaultRole(input: CreateUserInput): Promise<UserRecord> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          firebaseUid: input.firebaseUid,
          phone: input.phone,
          phoneVerifiedAt: input.phoneVerifiedAt,
          email: input.email ?? null,
          // Never set: verification requires sending mail, which is blocked (D-25).
          emailVerifiedAt: null,
          preferredLocale: input.preferredLocale,
          status: 'ACTIVE',
        })
        .returning(userColumns);

      if (!created) {
        throw new ConflictError('Could not create the user account.');
      }

      const [customerRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.key, 'CUSTOMER'))
        .limit(1);

      if (!customerRole) {
        // Reference data has not been seeded. Failing loudly is right: a silent
        // partial account would be far harder to notice than a 500 at sign-in.
        throw new ConflictError(
          'The CUSTOMER role is missing. Run the reference-data seed before sign-in.'
        );
      }

      await tx.insert(userRoles).values({
        userId: created.id,
        roleId: customerRole.id,
        scopeType: 'GLOBAL',
        scopeId: null,
      });

      return mapUser(created);
    });
  }

  async recordSuccessfulLogin(input: {
    userId: string;
    phone: string;
    phoneVerifiedAt: Date;
    email?: string | undefined;
    at: Date;
  }): Promise<void> {
    await this.db
      .update(users)
      .set({
        // Mirrored from the verified token so the operational contact number stays
        // correct if the user changes it in Firebase.
        phone: input.phone,
        phoneVerifiedAt: input.phoneVerifiedAt,
        ...(input.email ? { email: input.email } : {}),
        lastLoginAt: input.at,
        updatedAt: input.at,
      })
      .where(eq(users.id, input.userId));
  }

  // -------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------

  async listRoleGrants(userId: string): Promise<RoleGrant[]> {
    const rows = await this.db
      .select({
        grantId: userRoles.id,
        roleKey: roles.key,
        scopeType: userRoles.scopeType,
        scopeId: userRoles.scopeId,
        permissionKey: permissionRows.key,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissionRows, eq(permissionRows.id, rolePermissions.permissionId))
      // Revocation is applied in the query, so a revoked grant cannot be returned.
      .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt)));

    const grants = new Map<
      string,
      RoleGrant & { roleKey: RoleKey; permissions: PermissionKey[] }
    >();

    for (const row of rows) {
      if (!isRoleKey(row.roleKey)) continue;

      let grant = grants.get(row.grantId);
      if (!grant) {
        grant = {
          roleKey: row.roleKey,
          scopeType: row.scopeType as RoleScopeType,
          scopeId: row.scopeId,
          permissions: [],
        };
        grants.set(row.grantId, grant);
      }

      if (row.permissionKey && isPermissionKey(row.permissionKey)) {
        grant.permissions.push(row.permissionKey);
      }
    }

    return [...grants.values()];
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const [created] = await this.db
      .insert(sessions)
      .values({
        id: input.id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        firebaseTokenIssuedAt: input.firebaseTokenIssuedAt,
        ipHash: input.ipHash,
        userAgent: input.userAgent,
        lastSeenAt: new Date(),
      })
      .returning(sessionColumns);

    if (!created) {
      throw new ConflictError('Could not create the session.');
    }

    return mapSession(created);
  }

  async rotateSessionToken(sessionId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db.update(sessions).set({ tokenHash, expiresAt }).where(eq(sessions.id, sessionId));
  }

  /**
   * One query for session, user and roles.
   *
   * Roles are aggregated with `json_agg` rather than fetched separately because this
   * runs on EVERY authenticated request, and a second round trip to Postgres through
   * Hyperdrive on every page view is a cost worth avoiding.
   */
  async findSessionByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
    const [row] = await this.db
      .select({
        ...sessionColumns,
        user: userColumns,
        roles: sql<Array<{ roleKey: string; scopeType: string; scopeId: string | null }> | null>`(
          select json_agg(json_build_object(
            'roleKey', ${roles.key},
            'scopeType', ${userRoles.scopeType},
            'scopeId', ${userRoles.scopeId}
          ))
          from ${userRoles}
          join ${roles} on ${roles.id} = ${userRoles.roleId}
          where ${userRoles.userId} = ${users.id}
            and ${userRoles.revokedAt} is null
        )`.as('roles'),
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    if (!row) return null;

    return {
      session: mapSession(row),
      user: mapUser(row.user),
      roles: (row.roles ?? [])
        .filter((grant) => isRoleKey(grant.roleKey))
        .map((grant) => ({
          roleKey: grant.roleKey as RoleKey,
          scopeType: grant.scopeType as RoleScopeType,
          scopeId: grant.scopeId,
        })),
    };
  }

  async touchSession(sessionId: string, at: Date): Promise<void> {
    await this.db.update(sessions).set({ lastSeenAt: at }).where(eq(sessions.id, sessionId));
  }

  async revokeSession(sessionId: string, reason: string, at: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: at, revokedReason: reason })
      // Already-revoked rows are left alone so the original reason and time survive.
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  async revokeAllSessionsForUser(userId: string, reason: string, at: Date): Promise<number> {
    const revoked = await this.db
      .update(sessions)
      .set({ revokedAt: at, revokedReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });

    return revoked.length;
  }

  // -------------------------------------------------------------------------
  // Abuse signals
  // -------------------------------------------------------------------------

  async recordLoginAttempt(input: LoginAttemptInput): Promise<void> {
    await this.db.insert(loginAttempts).values({
      identifier: input.identifier,
      identifierType: input.identifierType,
      ipHash: input.ipHash,
      success: input.success,
      failureReason: input.failureReason,
      userAgent: input.userAgent,
    });
  }

  async countRecentFailedAttempts(ipHash: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.ipHash, ipHash),
          eq(loginAttempts.success, false),
          gte(loginAttempts.createdAt, since)
        )
      );

    return row?.total ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Column projections and mappers
// ---------------------------------------------------------------------------

/**
 * Explicit projections rather than `select()`.
 *
 * Named columns mean a new column added to `users` — a token, a hash, anything
 * sensitive — is not automatically hoisted into an API response by a repository that
 * selected everything.
 */
const userColumns = {
  id: users.id,
  firebaseUid: users.firebaseUid,
  phone: users.phone,
  phoneVerifiedAt: users.phoneVerifiedAt,
  email: users.email,
  fullName: users.fullName,
  preferredLocale: users.preferredLocale,
  status: users.status,
  lastLoginAt: users.lastLoginAt,
  deletedAt: users.deletedAt,
  anonymizedAt: users.anonymizedAt,
} as const;

const sessionColumns = {
  id: sessions.id,
  userId: sessions.userId,
  tokenHash: sessions.tokenHash,
  activeRoleId: sessions.activeRoleId,
  expiresAt: sessions.expiresAt,
  lastSeenAt: sessions.lastSeenAt,
  revokedAt: sessions.revokedAt,
  revokedReason: sessions.revokedReason,
  createdAt: sessions.createdAt,
} as const;

type UserRow = {
  id: string;
  firebaseUid: string;
  phone: string | null;
  phoneVerifiedAt: Date | null;
  email: string | null;
  fullName: string | null;
  preferredLocale: string;
  status: string;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
  anonymizedAt: Date | null;
};

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    firebaseUid: row.firebaseUid,
    phone: row.phone,
    phoneVerifiedAt: row.phoneVerifiedAt,
    email: row.email,
    fullName: row.fullName,
    preferredLocale: row.preferredLocale as Locale,
    status: row.status as UserStatus,
    lastLoginAt: row.lastLoginAt,
    deletedAt: row.deletedAt,
    anonymizedAt: row.anonymizedAt,
  };
}

function mapSession(row: {
  id: string;
  userId: string;
  tokenHash: string;
  activeRoleId: string | null;
  expiresAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
}): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    activeRoleId: row.activeRoleId,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    createdAt: row.createdAt,
  };
}

/** Factory matching the other modules' naming. */
export function createIdentityRepository(context: RepositoryContext): IdentityRepository {
  return new DrizzleIdentityRepository(context);
}
