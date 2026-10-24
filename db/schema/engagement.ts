import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, softDelete, timestamps, ts } from './_helpers';
import {
  campaignStatus,
  campaignType,
  localeCode,
  notificationChannel,
  notificationStatus,
  reviewStatus,
  ticketCategory,
  ticketPriority,
  ticketStatus,
} from './enums';
import { users } from './identity';
import { products } from './catalog';
import { stores } from './marketplace';
import { orders } from './commerce';
import { coupons } from './marketing';
import { drivers } from './delivery';

/**
 * Engagement domain (docs/DATABASE.md §9).
 */

/**
 * Reviews. Only DELIVERED orders may be reviewed, enforced in the service layer.
 * Aggregates on products/stores are updated transactionally on approval.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),

    rating: smallint('rating').notNull(),
    title: text('title'),
    comment: text('comment'),

    status: reviewStatus('status').notNull().default('PENDING'),
    moderatedBy: uuid('moderated_by').references(() => users.id, { onDelete: 'set null' }),
    moderatedAt: ts('moderated_at'),
    rejectionReason: text('rejection_reason'),

    isVerifiedPurchase: boolean('is_verified_purchase').notNull().default(true),
    helpfulCount: integer('helpful_count').notNull().default(0),

    vendorReply: text('vendor_reply'),
    vendorRepliedAt: ts('vendor_replied_at'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    // One review per purchased item. NULLS NOT DISTINCT so a store- or
    // driver-level review (no product) also cannot be duplicated.
    unique('reviews_user_order_product_key')
      .on(table.userId, table.orderId, table.productId)
      .nullsNotDistinct(),
    index('reviews_product_idx')
      .on(table.productId, table.status)
      .where(sql`deleted_at is null`),
    index('reviews_store_idx').on(table.storeId, table.status),
    index('reviews_driver_idx').on(table.driverId),
    index('reviews_moderation_idx').on(table.status, table.createdAt),
    check('reviews_rating_range', sql`${table.rating} between 1 and 5`),
  ]
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: primaryId(),
    name: text('name').notNull(),
    campaignType: campaignType('campaign_type').notNull(),
    audienceFilter: jsonb('audience_filter'),
    couponId: uuid('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
    templateId: uuid('template_id'),
    channel: notificationChannel('channel').notNull(),

    scheduledAt: ts('scheduled_at'),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    status: campaignStatus('status').notNull().default('DRAFT'),

    targetCount: integer('target_count').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    index('campaigns_status_idx').on(table.status, table.scheduledAt),
    index('campaigns_coupon_idx').on(table.couponId),
  ]
);

/**
 * Admin-editable templates with variables (master spec §21).
 *
 * V1 populates PUSH and IN_APP only — email is blocked by D-25 and non-OTP SMS by
 * D-34. Transactional events require BOTH `en` and `hi` rows (D-33).
 *
 * `provider_template_id` was originally the DLT id for SMS. Login OTP no longer
 * needs it because Firebase owns that delivery, but it is retained for the day
 * D-34 or D-25 is unblocked.
 */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: primaryId(),
    eventKey: text('event_key').notNull(),
    channel: notificationChannel('channel').notNull(),
    locale: localeCode('locale').notNull(),

    subject: text('subject'),
    body: text('body').notNull(),
    variables: jsonb('variables'),
    providerTemplateId: text('provider_template_id'),

    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('notification_templates_key').on(
      table.eventKey,
      table.channel,
      table.locale,
      table.version
    ),
    index('notification_templates_lookup_idx')
      .on(table.eventKey, table.channel, table.locale)
      .where(sql`is_active = true`),
  ]
);

export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventKey: text('event_key').notNull(),
    channel: notificationChannel('channel').notNull(),
    templateId: uuid('template_id').references(() => notificationTemplates.id, {
      onDelete: 'set null',
    }),

    title: text('title'),
    body: text('body').notNull(),
    data: jsonb('data'),
    status: notificationStatus('status').notNull().default('QUEUED'),

    providerMessageId: text('provider_message_id'),
    providerResponse: text('provider_response'),
    failureReason: text('failure_reason'),

    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    sentAt: ts('sent_at'),
    deliveredAt: ts('delivered_at'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (table) => [
    // The in-app notification centre — the only guaranteed outbound surface in V1.
    index('notifications_user_idx').on(table.userId, table.createdAt),
    index('notifications_retry_idx').on(table.status, table.createdAt),
    index('notifications_order_idx').on(table.orderId),
    index('notifications_template_idx').on(table.templateId),
    index('notifications_unread_idx')
      .on(table.userId)
      .where(sql`read_at is null`),
  ]
);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: primaryId(),
    ticketNumber: text('ticket_number').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),

    category: ticketCategory('category').notNull(),
    subject: text('subject').notNull(),
    status: ticketStatus('status').notNull().default('OPEN'),
    priority: ticketPriority('priority').notNull().default('MEDIUM'),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    slaDueAt: ts('sla_due_at'),
    firstResponseAt: ts('first_response_at'),
    resolvedAt: ts('resolved_at'),
    closedAt: ts('closed_at'),
    resolutionNote: text('resolution_note'),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('support_tickets_number_key').on(table.ticketNumber),
    index('support_tickets_user_idx').on(table.userId, table.createdAt),
    index('support_tickets_queue_idx').on(table.status, table.priority, table.slaDueAt),
    index('support_tickets_assignee_idx').on(table.assignedToUserId, table.status),
    index('support_tickets_order_idx').on(table.orderId),
  ]
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: primaryId(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    authorRole: text('author_role'),
    message: text('message').notNull(),

    /**
     * The single flag preventing internal commentary from leaking to the
     * customer. Filtered in the REPOSITORY read path, not just the UI — see
     * modules/support.
     */
    isInternalNote: boolean('is_internal_note').notNull().default(false),
    attachmentKeys: jsonb('attachment_keys'),
    createdAt: createdAt(),
  },
  (table) => [
    index('ticket_messages_ticket_idx').on(table.ticketId, table.createdAt),
    // The customer-visible thread, which must never include internal notes.
    index('ticket_messages_public_idx')
      .on(table.ticketId, table.createdAt)
      .where(sql`is_internal_note = false`),
  ]
);
