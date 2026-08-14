import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  latitude,
  longitude,
  paiseNotNull,
  primaryId,
  softDelete,
  timestamps,
  updatedAt,
} from './_helpers';
import { addressType, notificationCategory, notificationChannel } from './enums';
import { users } from './identity';
import { deliveryZones } from './location';
import { productVariants, products } from './catalog';

/**
 * Customer domain (docs/DATABASE.md §4).
 */

export const customerProfiles = pgTable(
  'customer_profiles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dateOfBirth: date('date_of_birth'),
    gender: text('gender'),
    defaultAddressId: uuid('default_address_id'),
    referralCode: text('referral_code'),
    acquisitionSource: text('acquisition_source'),

    /**
     * Denormalised counters, maintained transactionally, so admin lists do not
     * aggregate the whole order table on every page load.
     */
    totalOrders: integer('total_orders').notNull().default(0),
    lifetimeValuePaise: paiseNotNull('lifetime_value_paise'),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('customer_profiles_user_key').on(table.userId),
    uniqueIndex('customer_profiles_referral_key')
      .on(table.referralCode)
      .where(sql`referral_code is not null`),
  ]
);

export const addresses = pgTable(
  'addresses',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label'),
    addressType: addressType('address_type').notNull().default('HOME'),

    recipientName: text('recipient_name').notNull(),
    recipientPhone: text('recipient_phone').notNull(),

    line1: text('line1').notNull(),
    line2: text('line2'),
    landmark: text('landmark'),
    city: text('city').notNull(),
    state: text('state').notNull(),
    pincode: text('pincode').notNull(),
    country: text('country').notNull().default('IN'),

    latitude: latitude(),
    longitude: longitude(),
    /** Resolved at save time, then re-verified at checkout (master spec §11). */
    deliveryZoneId: uuid('delivery_zone_id').references(() => deliveryZones.id, {
      onDelete: 'set null',
    }),

    isDefault: boolean('is_default').notNull().default(false),
    deliveryInstructions: text('delivery_instructions'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('addresses_user_idx')
      .on(table.userId)
      .where(sql`deleted_at is null`),
    index('addresses_pincode_idx').on(table.pincode),
    index('addresses_zone_idx').on(table.deliveryZoneId),
    // Exactly one default address per user, enforced by the database.
    uniqueIndex('addresses_default_key')
      .on(table.userId)
      .where(sql`is_default = true and deleted_at is null`),
  ]
);

/** Favorites. One default list per user; the table shape allows more later. */
export const wishlists = pgTable(
  'wishlists',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Favorites'),
    isDefault: boolean('is_default').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('wishlists_user_default_key')
      .on(table.userId)
      .where(sql`is_default = true`),
    index('wishlists_user_idx').on(table.userId),
  ]
);

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    id: primaryId(),
    wishlistId: uuid('wishlist_id')
      .notNull()
      .references(() => wishlists.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    // NULLS NOT DISTINCT so a product without a chosen variant cannot be added
    // twice — the default NULL-distinct behaviour would allow duplicates.
    unique('wishlist_items_unique_key')
      .on(table.wishlistId, table.productId, table.variantId)
      .nullsNotDistinct(),
    index('wishlist_items_product_idx').on(table.productId),
  ]
);

/**
 * Per-channel, per-category preferences.
 *
 * Transactional order notifications are NOT opt-out-able; only `PROMOTION`
 * respects this fully (docs/DATABASE.md §4). That distinction is enforced in the
 * notification service, not here.
 */
export const customerNotificationPreferences = pgTable(
  'customer_notification_preferences',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: notificationChannel('channel').notNull(),
    category: notificationCategory('category').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('customer_notification_preferences_key').on(
      table.userId,
      table.channel,
      table.category
    ),
  ]
);
