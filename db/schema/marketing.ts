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
import { paise, paiseNotNull, percentage, primaryId, softDelete, timestamps, ts } from './_helpers';
import {
  bannerPlacement,
  cancellationActorRole,
  couponRestrictionType,
  couponType,
  discountScope,
  orderStatus,
  paymentMethodScope,
  promotionType,
  targetAudience,
} from './enums';
import { users } from './identity';
import { deliveryZones } from './location';

/**
 * Marketing engine (docs/DATABASE.md §6, master spec §18).
 *
 * Marketing is first-class data, not hardcoded: coupons, promotions and banners
 * are all admin-managed rows evaluated by the shared pricing module.
 */

/** Covers every coupon rule in master spec §18. */
export const coupons = pgTable(
  'coupons',
  {
    id: primaryId(),
    /** Stored uppercase; comparison is exact. */
    code: text('code').notNull(),
    // name/description -> coupon_translations (D-33)

    couponType: couponType('coupon_type').notNull(),
    /** Flat amount in paise, or a percentage — interpreted per `couponType`. */
    discountValue: paiseNotNull('discount_value'),
    maxDiscountPaise: paise('max_discount_paise'),
    minCartPaise: paiseNotNull('min_cart_paise'),
    scope: discountScope('scope').notNull().default('CART'),

    firstOrderOnly: boolean('first_order_only').notNull().default(false),
    isUserSpecific: boolean('is_user_specific').notNull().default(false),

    usageLimitTotal: integer('usage_limit_total'),
    usageLimitPerUser: integer('usage_limit_per_user'),
    usedCount: integer('used_count').notNull().default(0),

    validFrom: ts('valid_from'),
    validUntil: ts('valid_until'),
    isActive: boolean('is_active').notNull().default(true),
    isStackable: boolean('is_stackable').notNull().default(false),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('coupons_code_key').on(table.code),
    index('coupons_active_idx')
      .on(table.isActive, table.validUntil)
      .where(sql`deleted_at is null`),
  ]
);

/** Keeps coupon scoping relational and queryable instead of a JSON blob. */
export const couponRestrictions = pgTable(
  'coupon_restrictions',
  {
    id: primaryId(),
    couponId: uuid('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'cascade' }),
    restrictionType: couponRestrictionType('restriction_type').notNull(),
    /** Polymorphic: category, product, vendor, zone or user id. */
    restrictionId: uuid('restriction_id').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('coupon_restrictions_key').on(
      table.couponId,
      table.restrictionType,
      table.restrictionId
    ),
    index('coupon_restrictions_coupon_idx').on(table.couponId),
  ]
);

export const banners = pgTable(
  'banners',
  {
    id: primaryId(),
    // title/subtitle/cta_label/images -> banner_translations (D-33), because
    // creative copy and artwork can legitimately differ per language.
    placement: bannerPlacement('placement').notNull(),
    linkUrl: text('link_url'),

    targetAudience: targetAudience('target_audience').notNull().default('ALL'),
    /**
     * ⚠️ No `segments` table is defined in docs/DATABASE.md, so this is an
     * unconstrained id rather than a foreign key. Flagged for confirmation; the
     * SEGMENT audience cannot be used until segments exist.
     */
    segmentId: uuid('segment_id'),

    deliveryZoneId: uuid('delivery_zone_id').references(() => deliveryZones.id, {
      onDelete: 'cascade',
    }),
    priority: smallint('priority').notNull().default(0),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    isActive: boolean('is_active').notNull().default(true),

    clickCount: integer('click_count').notNull().default(0),
    impressionCount: integer('impression_count').notNull().default(0),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('banners_placement_idx')
      .on(table.placement, table.priority)
      .where(sql`is_active = true and deleted_at is null`),
    index('banners_zone_idx').on(table.deliveryZoneId),
    index('banners_schedule_idx').on(table.startsAt, table.endsAt),
  ]
);

export const promotions = pgTable(
  'promotions',
  {
    id: primaryId(),
    name: text('name').notNull(),
    promotionType: promotionType('promotion_type').notNull(),
    description: text('description'),
    bannerId: uuid('banner_id').references(() => banners.id, { onDelete: 'set null' }),

    /** Stacking order is resolved by priority in the pricing module. */
    priority: smallint('priority').notNull().default(0),
    validFrom: ts('valid_from'),
    validUntil: ts('valid_until'),
    isActive: boolean('is_active').notNull().default(true),
    zoneScope: uuid('zone_scope').references(() => deliveryZones.id, { onDelete: 'set null' }),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('promotions_active_idx')
      .on(table.isActive, table.priority)
      .where(sql`deleted_at is null`),
    index('promotions_banner_idx').on(table.bannerId),
    index('promotions_zone_idx').on(table.zoneScope),
  ]
);

export const promotionRules = pgTable(
  'promotion_rules',
  {
    id: primaryId(),
    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id, { onDelete: 'cascade' }),
    ruleKey: text('rule_key').notNull(),
    ruleValue: jsonb('rule_value').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('promotion_rules_key').on(table.promotionId, table.ruleKey),
    index('promotion_rules_promotion_idx').on(table.promotionId),
  ]
);

/**
 * Cancellation and refund policy engine (D-19).
 *
 * The rules are DATA, not conditionals scattered through services. The service
 * resolves the matching row for (actor, current status, payment method) and
 * either permits the cancellation with the computed refund or rejects it.
 *
 * ⚠️ D-19a: only a deliberately conservative seed is loaded. Every other window,
 * percentage, restocking and driver-compensation value requires product input
 * and is NOT invented here.
 */
export const cancellationPolicies = pgTable(
  'cancellation_policies',
  {
    id: primaryId(),
    actorRole: cancellationActorRole('actor_role').notNull(),
    /** The order status at which cancellation is attempted. */
    fromStatus: orderStatus('from_status').notNull(),
    isAllowed: boolean('is_allowed').notNull().default(false),
    /** Time from order placement; NULL means no limit. */
    windowMinutes: integer('window_minutes'),
    refundPercent: percentage('refund_percent').notNull().default('0'),
    refundDeliveryFee: boolean('refund_delivery_fee').notNull().default(false),
    requiresReason: boolean('requires_reason').notNull().default(true),
    restock: boolean('restock').notNull().default(true),
    compensateDriver: boolean('compensate_driver').notNull().default(false),
    paymentMethodScope: paymentMethodScope('payment_method_scope').notNull().default('ALL'),
    priority: smallint('priority').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('cancellation_policies_key')
      .on(table.actorRole, table.fromStatus, table.paymentMethodScope)
      .where(sql`is_active = true`),
    index('cancellation_policies_lookup_idx').on(table.actorRole, table.fromStatus),
  ]
);
