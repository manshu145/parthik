import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, softDelete, timestamps, ts } from './_helpers';
import {
  localeCode,
  notificationChannel,
  otpPurpose,
  pushPermission,
  roleKey,
  roleScopeType,
  userStatus,
} from './enums';

/**
 * Identity domain (docs/DATABASE.md §3).
 *
 * Firebase Authentication verifies identity; Parthik owns authorization. The join
 * key is `users.firebase_uid`, written once from a *verified* token and never
 * from client input.
 *
 * Roles live here and never in Firebase custom claims, so authorization has
 * exactly one source of truth (D-08/D-36).
 */

export const users = pgTable(
  'users',
  {
    id: primaryId(),

    /** D-08: the Firebase↔Parthik join key. Primary lookup on every sign-in. */
    firebaseUid: text('firebase_uid').notNull(),

    phone: text('phone'),
    phoneVerifiedAt: ts('phone_verified_at'),

    email: text('email'),
    /** Always NULL in V1 — email cannot be verified without sending mail (D-25). */
    emailVerifiedAt: ts('email_verified_at'),

    // NO password_hash column. D-09: Firebase phone OTP only.

    fullName: text('full_name'),
    /** D-33 bilingual: drives locale resolution for authenticated users. */
    preferredLocale: localeCode('preferred_locale').notNull().default('en'),

    status: userStatus('status').notNull().default('ACTIVE'),
    lastLoginAt: ts('last_login_at'),

    ...timestamps,
    ...softDelete,
    /** Right-to-deletion is anonymise-in-place so order history survives (§1). */
    anonymizedAt: ts('anonymized_at'),
  },
  (table) => [
    uniqueIndex('users_firebase_uid_key').on(table.firebaseUid),
    uniqueIndex('users_phone_key').on(table.phone),
    // Case-insensitive uniqueness: Foo@x.com and foo@x.com are the same account.
    uniqueIndex('users_email_lower_key').on(sql`lower(${table.email})`),
    index('users_status_idx').on(table.status),
    check('users_contact_present', sql`${table.phone} is not null or ${table.email} is not null`),
  ]
);

export const roles = pgTable(
  'roles',
  {
    id: primaryId(),
    key: roleKey('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** System roles cannot be deleted or renamed through the admin UI. */
    isSystem: boolean('is_system').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('roles_key_key').on(table.key)]
);

export const permissions = pgTable(
  'permissions',
  {
    id: primaryId(),
    /** `resource:action`, e.g. `order:refund` (docs/SECURITY.md §5.3). */
    key: text('key').notNull(),
    resource: text('resource').notNull(),
    action: text('action').notNull(),
    description: text('description'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('permissions_key_key').on(table.key),
    index('permissions_resource_idx').on(table.resource),
  ]
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    index('role_permissions_permission_idx').on(table.permissionId),
  ]
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),

    /**
     * Scope is what makes vendor staff possible: the same VENDOR_STAFF role
     * granted against different vendors.
     */
    scopeType: roleScopeType('scope_type').notNull().default('GLOBAL'),
    scopeId: uuid('scope_id'),

    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    grantedAt: ts('granted_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (table) => [
    // A grant is unique only while live, so a revoked grant can be re-issued.
    uniqueIndex('user_roles_active_key')
      .on(table.userId, table.roleId, table.scopeId)
      .where(sql`revoked_at is null`),
    index('user_roles_user_idx').on(table.userId),
    index('user_roles_role_idx').on(table.roleId),
    index('user_roles_scope_idx').on(table.scopeType, table.scopeId),
  ]
);

/**
 * Server-side sessions (D-10). Revocable, role-specific lifetimes.
 *
 * Only the HASH of the session token is stored, so a database leak does not
 * yield usable sessions.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    activeRoleId: uuid('active_role_id').references(() => roles.id, { onDelete: 'set null' }),
    deviceId: uuid('device_id'),

    /**
     * When the Firebase sign-in that produced this session occurred. The Firebase
     * token itself is deliberately NOT retained — only enough to trace an
     * incident back to an auth event.
     */
    firebaseTokenIssuedAt: ts('firebase_token_issued_at'),

    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at'),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
    index('sessions_expires_idx').on(table.expiresAt),
  ]
);

/**
 * OTP storage, reduced in scope by D-24.
 *
 * Login and signup OTP is generated, delivered and verified entirely by Firebase
 * — we never see those codes. This table exists for DELIVERY OTP (D-20) and any
 * future non-Firebase need.
 */
export const otpVerifications = pgTable(
  'otp_verifications',
  {
    id: primaryId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    destination: text('destination').notNull(),
    channel: notificationChannel('channel').notNull(),
    /** V1 uses ORDER_DELIVERY only. */
    purpose: otpPurpose('purpose').notNull(),
    /** Hashed, never plaintext, never logged. */
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
  },
  (table) => [
    index('otp_verifications_lookup_idx').on(table.destination, table.purpose, table.createdAt),
    index('otp_verifications_user_idx').on(table.userId),
  ]
);

/**
 * Records the token-exchange step, not OTP entry.
 *
 * Firebase handles OTP attempts, so what we can observe and rate-limit is
 * `POST /auth/session`. On a FAILED verification there is no trustworthy
 * identifier, so lockout keys on IP only (docs/SECURITY.md §2.4).
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: primaryId(),
    identifier: text('identifier'),
    identifierType: text('identifier_type'),
    ipHash: text('ip_hash'),
    success: boolean('success').notNull(),
    failureReason: text('failure_reason'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (table) => [
    index('login_attempts_identifier_idx').on(table.identifier, table.createdAt),
    index('login_attempts_ip_idx').on(table.ipHash, table.createdAt),
  ]
);

/**
 * Devices and their FCM registration tokens (D-26).
 *
 * `push_permission` is stored because with email (D-25) and SMS (D-34) both
 * blocked, knowing which users are unreachable is operationally important.
 */
export const devices = pgTable(
  'devices',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceFingerprint: text('device_fingerprint'),
    platform: text('platform'),

    fcmToken: text('fcm_token'),
    /** Drives pruning: FCM rejects stale tokens and we must not retry forever. */
    fcmTokenUpdatedAt: ts('fcm_token_updated_at'),
    pushPermission: pushPermission('push_permission').notNull().default('DEFAULT'),

    lastActiveAt: ts('last_active_at'),
    isTrusted: boolean('is_trusted').notNull().default(false),
    createdAt: createdAt(),
    revokedAt: ts('revoked_at'),
  },
  (table) => [
    index('devices_user_idx').on(table.userId),
    uniqueIndex('devices_fcm_token_key')
      .on(table.fcmToken)
      .where(sql`fcm_token is not null`),
  ]
);
