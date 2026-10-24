import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamps, ts } from './_helpers';
import { auditAction, systemEventSeverity, webhookDirection } from './enums';
import { users } from './identity';

/**
 * Administration domain (docs/DATABASE.md §11).
 */

/**
 * Key-value settings with typing and sensitivity (master spec §34).
 *
 * Sensitive settings (payment keys, refund limits, maintenance mode) require
 * elevated permission and are always audited. Read through a 60-second cache so
 * maintenance mode propagates quickly.
 */
export const adminSettings = pgTable(
  'admin_settings',
  {
    id: primaryId(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    valueType: text('value_type').notNull(),
    groupName: text('group_name').notNull(),

    label: text('label').notNull(),
    description: text('description'),
    isSensitive: boolean('is_sensitive').notNull().default(false),
    /** When set, only holders of this permission may read or write the setting. */
    requiredPermission: text('required_permission'),

    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('admin_settings_key_key').on(table.key),
    index('admin_settings_group_idx').on(table.groupName),
  ]
);

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: primaryId(),
    key: text('key').notNull(),
    description: text('description'),
    isEnabled: boolean('is_enabled').notNull().default(false),
    rolloutPercentage: smallint('rollout_percentage').notNull().default(0),
    enabledForRoles: jsonb('enabled_for_roles'),
    enabledForZones: jsonb('enabled_for_zones'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [uniqueIndex('feature_flags_key_key').on(table.key)]
);

/**
 * Audit log — APPEND ONLY. No updates, no deletes, ever (master spec §23, §30).
 *
 * `before`/`after` are field-filtered by the writer to exclude secrets and full
 * PII, so the audit trail cannot itself become a data-leak surface.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role'),
    actorIpHash: text('actor_ip_hash'),
    actorUserAgent: text('actor_user_agent'),

    action: auditAction('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),

    before: jsonb('before'),
    after: jsonb('after'),
    changedFields: jsonb('changed_fields'),

    reason: text('reason'),
    /** Ties an audit row to the request that produced it. */
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_logs_entity_idx').on(table.entityType, table.entityId, table.createdAt),
    index('audit_logs_actor_idx').on(table.actorUserId, table.createdAt),
    index('audit_logs_action_idx').on(table.action, table.createdAt),
    index('audit_logs_request_idx').on(table.requestId),
  ]
);

/** Operational, non-user events for the admin System Health screen. */
export const systemEvents = pgTable(
  'system_events',
  {
    id: primaryId(),
    eventType: text('event_type').notNull(),
    severity: systemEventSeverity('severity').notNull().default('INFO'),
    source: text('source'),
    message: text('message').notNull(),
    context: jsonb('context'),
    requestId: text('request_id'),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('system_events_severity_idx').on(table.severity, table.createdAt),
    index('system_events_type_idx').on(table.eventType, table.createdAt),
    index('system_events_unresolved_idx')
      .on(table.createdAt)
      .where(sql`resolved_at is null`),
  ]
);

/**
 * Webhook log. Retains the raw payload and signature-verification result for
 * dispute resolution (docs/SECURITY.md §11).
 */
export const webhookLogs = pgTable(
  'webhook_logs',
  {
    id: primaryId(),
    direction: webhookDirection('direction').notNull(),
    provider: text('provider').notNull(),
    endpoint: text('endpoint'),
    eventType: text('event_type'),

    httpStatus: integer('http_status'),
    rawHeaders: jsonb('raw_headers'),
    rawBody: text('raw_body'),
    signatureValid: boolean('signature_valid'),

    attempt: smallint('attempt').notNull().default(1),
    processed: boolean('processed').notNull().default(false),
    errorMessage: text('error_message'),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (table) => [
    index('webhook_logs_provider_idx').on(table.provider, table.createdAt),
    index('webhook_logs_unprocessed_idx')
      .on(table.createdAt)
      .where(sql`processed = false`),
    index('webhook_logs_invalid_signature_idx')
      .on(table.createdAt)
      .where(sql`signature_valid = false`),
  ]
);

/**
 * Durable idempotency backstop behind the cache-based check, so a cache flush
 * cannot cause a double order (docs/API_SPEC.md §1.6).
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: primaryId(),
    key: text('key').notNull(),
    scope: text('scope').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Same key with a different request hash is a client bug, not a retry. */
    requestHash: text('request_hash').notNull(),

    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    lockedAt: ts('locked_at'),
    completedAt: ts('completed_at'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('idempotency_keys_key_key').on(table.key),
    index('idempotency_keys_expiry_idx').on(table.expiresAt),
    index('idempotency_keys_user_idx').on(table.userId),
  ]
);
