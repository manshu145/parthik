import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  auditLogs,
  deliveryZones,
  featureFlags,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { isPermissionKey, isRoleKey, type RoleKey } from '@/modules/identity';

const EDITABLE_ROLE_KEYS: readonly RoleKey[] = [
  'ADMIN',
  'ADMIN_SUPPORT',
  'ADMIN_OPS',
  'ADMIN_FINANCE',
];

export const MANAGEABLE_ADMIN_ROLE_KEYS: readonly RoleKey[] = [
  'ADMIN',
  'ADMIN_SUPPORT',
  'ADMIN_OPS',
  'ADMIN_FINANCE',
  'SUPER_ADMIN',
];

export async function listAdminRoleManagement() {
  const db = await getDb();
  const [roleRows, permissionRows, grantRows] = await Promise.all([
    db
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
      })
      .from(roles)
      .orderBy(asc(roles.name)),
    db
      .select({
        id: permissions.id,
        key: permissions.key,
        resource: permissions.resource,
        action: permissions.action,
        description: permissions.description,
      })
      .from(permissions)
      .orderBy(asc(permissions.resource), asc(permissions.action)),
    db
      .select({
        roleId: rolePermissions.roleId,
        permissionKey: permissions.key,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)),
  ]);

  const byRole = new Map<string, string[]>();
  for (const grant of grantRows) {
    const list = byRole.get(grant.roleId) ?? [];
    list.push(grant.permissionKey);
    byRole.set(grant.roleId, list);
  }

  return {
    roles: roleRows.map((role) => ({
      ...role,
      permissionKeys: byRole.get(role.id) ?? [],
      editable: EDITABLE_ROLE_KEYS.includes(role.key as RoleKey),
      wildcard: role.key === 'SUPER_ADMIN',
    })),
    permissions: permissionRows,
  };
}

export async function updateAdminRolePermissions(
  roleId: string,
  permissionKeys: string[],
  actorUserId: string
) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [role] = await tx
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);

    if (!role) throw new NotFoundError('Role not found.');
    if (!EDITABLE_ROLE_KEYS.includes(role.key as RoleKey)) {
      throw new ConflictError('Core customer, vendor, driver roles and SUPER_ADMIN are protected.');
    }

    const uniqueKeys = [...new Set(permissionKeys)];
    for (const key of uniqueKeys) {
      if (!isPermissionKey(key)) {
        throw new ValidationError('Unknown permission: ' + key);
      }
    }

    const permissionRows =
      uniqueKeys.length > 0
        ? await tx
            .select({ id: permissions.id, key: permissions.key })
            .from(permissions)
            .where(inArray(permissions.key, uniqueKeys))
        : [];

    if (permissionRows.length !== uniqueKeys.length) {
      throw new ValidationError('One or more permissions are not seeded.');
    }

    const beforeRows = await tx
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, roleId));

    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));

    if (permissionRows.length > 0) {
      await tx.insert(rolePermissions).values(
        permissionRows.map((permission) => ({
          roleId,
          permissionId: permission.id,
        }))
      );
    }

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'SUPER_ADMIN',
      action: 'UPDATE',
      entityType: 'role',
      entityId: roleId,
      before: { permissionKeys: beforeRows.map((row) => row.key) },
      after: { permissionKeys: uniqueKeys },
      changedFields: ['permissions'],
      reason: 'Admin role permissions updated',
    });

    return { id: roleId, permissionKeys: uniqueKeys };
  });
}

export async function listAdminUserManagement(limit = 300) {
  const db = await getDb();
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      phone: users.phone,
      email: users.email,
      status: users.status,
      preferredLocale: users.preferredLocale,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      roleKey: roles.key,
      scopeType: userRoles.scopeType,
      scopeId: userRoles.scopeId,
    })
    .from(users)
    .leftJoin(userRoles, and(eq(userRoles.userId, users.id), isNull(userRoles.revokedAt)))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .where(isNull(users.deletedAt))
    .orderBy(desc(users.createdAt))
    .limit(Math.max(1, limit) * 8);

  const grouped = new Map<
    string,
    {
      id: string;
      fullName: string | null;
      phone: string | null;
      email: string | null;
      status: string;
      preferredLocale: string;
      createdAt: Date;
      lastLoginAt: Date | null;
      roles: string[];
      adminRoleKeys: string[];
    }
  >();

  for (const row of rows) {
    let user = grouped.get(row.id);
    if (!user) {
      user = {
        id: row.id,
        fullName: row.fullName,
        phone: row.phone,
        email: row.email,
        status: row.status,
        preferredLocale: row.preferredLocale,
        createdAt: row.createdAt,
        lastLoginAt: row.lastLoginAt,
        roles: [],
        adminRoleKeys: [],
      };
      grouped.set(row.id, user);
    }

    if (row.roleKey) {
      const roleLabel =
        row.scopeType === 'GLOBAL' || !row.scopeId
          ? row.roleKey
          : row.roleKey + ' (' + row.scopeType + ')';
      user.roles.push(roleLabel);

      if (
        row.scopeType === 'GLOBAL' &&
        MANAGEABLE_ADMIN_ROLE_KEYS.includes(row.roleKey as RoleKey)
      ) {
        user.adminRoleKeys.push(row.roleKey);
      }
    }
  }

  return [...grouped.values()].slice(0, limit);
}

export async function updateAdminUserAccess(
  userId: string,
  input: { status: 'ACTIVE' | 'SUSPENDED'; adminRoleKeys: string[] },
  actorUserId: string
) {
  const db = await getDb();
  const now = new Date();

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!target) throw new NotFoundError('User not found.');

    const desired: RoleKey[] = [];
    for (const value of [...new Set(input.adminRoleKeys)]) {
      if (!isRoleKey(value) || !MANAGEABLE_ADMIN_ROLE_KEYS.includes(value)) {
        throw new ValidationError('Only global admin roles can be managed here.');
      }
      desired.push(value);
    }

    const currentGrants = await tx
      .select({
        grantId: userRoles.id,
        roleKey: roles.key,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.scopeType, 'GLOBAL'),
          isNull(userRoles.revokedAt)
        )
      );

    const currentAdminKeys = currentGrants
      .map((grant) => grant.roleKey as RoleKey)
      .filter((key) => MANAGEABLE_ADMIN_ROLE_KEYS.includes(key));

    const removesSuperAdmin =
      currentAdminKeys.includes('SUPER_ADMIN') && !desired.includes('SUPER_ADMIN');
    const suspendsSuperAdmin =
      currentAdminKeys.includes('SUPER_ADMIN') && input.status !== 'ACTIVE';

    if (removesSuperAdmin || suspendsSuperAdmin) {
      const [countRow] = await tx
        .select({ count: count(userRoles.id) })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(
          and(
            eq(roles.key, 'SUPER_ADMIN'),
            eq(userRoles.scopeType, 'GLOBAL'),
            isNull(userRoles.revokedAt),
            eq(users.status, 'ACTIVE'),
            isNull(users.deletedAt)
          )
        );

      if (Number(countRow?.count ?? 0) <= 1) {
        throw new ConflictError('The last active SUPER_ADMIN cannot be removed or suspended.');
      }
    }

    await tx
      .update(users)
      .set({ status: input.status, updatedAt: now })
      .where(eq(users.id, userId));

    for (const grant of currentGrants) {
      const key = grant.roleKey as RoleKey;
      if (MANAGEABLE_ADMIN_ROLE_KEYS.includes(key) && !desired.includes(key)) {
        await tx.update(userRoles).set({ revokedAt: now }).where(eq(userRoles.id, grant.grantId));
      }
    }

    const missing = desired.filter((key) => !currentAdminKeys.includes(key));
    if (missing.length > 0) {
      const roleRows = await tx
        .select({ id: roles.id, key: roles.key })
        .from(roles)
        .where(inArray(roles.key, missing));

      if (roleRows.length !== missing.length) {
        throw new ConflictError('One or more admin roles are missing from reference data.');
      }

      await tx.insert(userRoles).values(
        roleRows.map((role) => ({
          userId,
          roleId: role.id,
          scopeType: 'GLOBAL' as const,
          scopeId: null,
          grantedBy: actorUserId,
          grantedAt: now,
        }))
      );
    }

    await tx
      .update(sessions)
      .set({
        revokedAt: now,
        revokedReason: 'admin_access_changed',
      })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'SUPER_ADMIN',
      action: 'UPDATE',
      entityType: 'admin_user',
      entityId: userId,
      before: { status: target.status, adminRoleKeys: currentAdminKeys },
      after: { status: input.status, adminRoleKeys: desired },
      changedFields: ['status', 'adminRoleKeys'],
      reason: 'Admin user access updated',
    });

    return { id: userId, status: input.status, adminRoleKeys: desired };
  });
}

export async function listAdminFeatureFlagManagement() {
  const db = await getDb();
  const [flags, zones] = await Promise.all([
    db
      .select({
        id: featureFlags.id,
        key: featureFlags.key,
        description: featureFlags.description,
        isEnabled: featureFlags.isEnabled,
        rolloutPercentage: featureFlags.rolloutPercentage,
        enabledForRoles: featureFlags.enabledForRoles,
        enabledForZones: featureFlags.enabledForZones,
        updatedAt: featureFlags.updatedAt,
      })
      .from(featureFlags)
      .orderBy(asc(featureFlags.key)),
    db
      .select({
        id: deliveryZones.id,
        name: deliveryZones.name,
        code: deliveryZones.code,
      })
      .from(deliveryZones)
      .orderBy(asc(deliveryZones.name)),
  ]);

  return {
    flags: flags.map((flag) => ({
      ...flag,
      enabledForRoles: stringArray(flag.enabledForRoles),
      enabledForZones: stringArray(flag.enabledForZones),
    })),
    zones,
  };
}

export async function createAdminFeatureFlag(
  input: {
    key: string;
    description: string | null;
    isEnabled: boolean;
    rolloutPercentage: number;
    enabledForRoles: string[];
    enabledForZones: string[];
  },
  actorUserId: string
) {
  const db = await getDb();

  const [existing] = await db
    .select({ id: featureFlags.id })
    .from(featureFlags)
    .where(eq(featureFlags.key, input.key))
    .limit(1);

  if (existing) throw new ConflictError('That feature flag key already exists.');

  const [created] = await db
    .insert(featureFlags)
    .values({
      key: input.key,
      description: input.description,
      isEnabled: input.isEnabled,
      rolloutPercentage: input.rolloutPercentage,
      enabledForRoles: input.enabledForRoles,
      enabledForZones: input.enabledForZones,
      updatedBy: actorUserId,
    })
    .returning({ id: featureFlags.id });

  if (!created) throw new ConflictError('Could not create feature flag.');

  await db.insert(auditLogs).values({
    actorUserId,
    actorRole: 'SUPER_ADMIN',
    action: 'CREATE',
    entityType: 'feature_flag',
    entityId: created.id,
    after: {
      key: input.key,
      isEnabled: input.isEnabled,
      rolloutPercentage: input.rolloutPercentage,
    },
    changedFields: [
      'key',
      'description',
      'isEnabled',
      'rolloutPercentage',
      'enabledForRoles',
      'enabledForZones',
    ],
    reason: 'Feature flag created',
  });

  return created;
}

export async function updateAdminFeatureFlag(
  id: string,
  input: {
    description: string | null;
    isEnabled: boolean;
    rolloutPercentage: number;
    enabledForRoles: string[];
    enabledForZones: string[];
  },
  actorUserId: string
) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: featureFlags.id,
        key: featureFlags.key,
        isEnabled: featureFlags.isEnabled,
        rolloutPercentage: featureFlags.rolloutPercentage,
      })
      .from(featureFlags)
      .where(eq(featureFlags.id, id))
      .limit(1);

    if (!before) throw new NotFoundError('Feature flag not found.');

    await tx
      .update(featureFlags)
      .set({
        description: input.description,
        isEnabled: input.isEnabled,
        rolloutPercentage: input.rolloutPercentage,
        enabledForRoles: input.enabledForRoles,
        enabledForZones: input.enabledForZones,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      })
      .where(eq(featureFlags.id, id));

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'SUPER_ADMIN',
      action: 'UPDATE',
      entityType: 'feature_flag',
      entityId: id,
      before,
      after: {
        isEnabled: input.isEnabled,
        rolloutPercentage: input.rolloutPercentage,
        enabledForRoles: input.enabledForRoles,
        enabledForZones: input.enabledForZones,
      },
      changedFields: [
        'description',
        'isEnabled',
        'rolloutPercentage',
        'enabledForRoles',
        'enabledForZones',
      ],
      reason: 'Feature flag updated',
    });

    return { id };
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
