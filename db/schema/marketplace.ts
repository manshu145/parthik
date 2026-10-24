import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  latitude,
  longitude,
  paiseNotNull,
  percentage,
  primaryId,
  softDelete,
  timestamps,
  ts,
} from './_helpers';
import { kycStatus, storeStatus, vendorDocType, vendorStatus } from './enums';
import { users } from './identity';
import { deliveryZones } from './location';

/**
 * Marketplace domain (docs/DATABASE.md §5).
 *
 * Vendor isolation is enforced in the REPOSITORY layer, not by database RLS
 * (docs/SECURITY.md §9.6): every vendor-scoped query is written to require a
 * vendor id, so a service that forgets a check still cannot return another
 * vendor's rows.
 */

export const vendors = pgTable(
  'vendors',
  {
    id: primaryId(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    businessName: text('business_name').notNull(),
    legalName: text('legal_name'),
    slug: text('slug').notNull(),
    status: vendorStatus('status').notNull().default('APPLIED'),

    gstin: text('gstin'),
    pan: text('pan'),
    fssaiLicense: text('fssai_license'),

    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),

    /** D-15: used for CALCULATION only. No automated settlement in V1. */
    commissionRate: percentage('commission_rate'),

    approvedAt: ts('approved_at'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    rejectionReason: text('rejection_reason'),
    suspendedAt: ts('suspended_at'),
    suspensionReason: text('suspension_reason'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('vendors_slug_key').on(table.slug),
    index('vendors_owner_idx').on(table.ownerUserId),
    index('vendors_status_idx')
      .on(table.status)
      .where(sql`deleted_at is null`),
  ]
);

/**
 * Vendor staff. Capabilities come from `user_roles` scoped to the vendor; this
 * table only records the relationship and its lifecycle.
 */
export const vendorUsers = pgTable(
  'vendor_users',
  {
    id: primaryId(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    designation: text('designation'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    invitedAt: ts('invited_at'),
    acceptedAt: ts('accepted_at'),
    removedAt: ts('removed_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('vendor_users_active_key')
      .on(table.vendorId, table.userId)
      .where(sql`removed_at is null`),
    index('vendor_users_user_idx').on(table.userId),
  ]
);

/** KYC documents. `storage_key` points at the PRIVATE R2 bucket. */
export const vendorDocuments = pgTable(
  'vendor_documents',
  {
    id: primaryId(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    docType: vendorDocType('doc_type').notNull(),

    storageKey: text('storage_key').notNull(),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),

    kycStatus: kycStatus('kyc_status').notNull().default('PENDING'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: ts('reviewed_at'),
    rejectionReason: text('rejection_reason'),
    expiresAt: ts('expires_at'),
    ...timestamps,
  },
  (table) => [
    index('vendor_documents_vendor_idx').on(table.vendorId),
    index('vendor_documents_status_idx').on(table.kycStatus),
    // Drives the expiry reminder job.
    index('vendor_documents_expiry_idx')
      .on(table.expiresAt)
      .where(sql`expires_at is not null`),
  ]
);

/**
 * Bank details. The full account number is encrypted at rest and only `last4` is
 * readable in the UI; an admin reveal is an audited action (docs/SECURITY.md §9.2).
 */
export const vendorBankAccounts = pgTable(
  'vendor_bank_accounts',
  {
    id: primaryId(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    accountHolderName: text('account_holder_name').notNull(),
    accountNumberEncrypted: text('account_number_encrypted').notNull(),
    accountNumberLast4: text('account_number_last4').notNull(),
    ifsc: text('ifsc').notNull(),
    bankName: text('bank_name'),
    isVerified: boolean('is_verified').notNull().default(false),
    verifiedAt: ts('verified_at'),
    isPrimary: boolean('is_primary').notNull().default(false),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('vendor_bank_accounts_vendor_idx').on(table.vendorId),
    uniqueIndex('vendor_bank_accounts_primary_key')
      .on(table.vendorId)
      .where(sql`is_primary = true and deleted_at is null`),
  ]
);

/**
 * Stores. Schema supports N per vendor; the V1 UI exposes one (D-32 still open,
 * but the schema is unaffected either way).
 */
export const stores = pgTable(
  'stores',
  {
    id: primaryId(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: storeStatus('status').notNull().default('CLOSED'),
    description: text('description'),
    logoKey: text('logo_key'),
    bannerKey: text('banner_key'),

    line1: text('line1'),
    line2: text('line2'),
    city: text('city'),
    state: text('state'),
    pincode: text('pincode'),
    latitude: latitude(),
    longitude: longitude(),

    /** D-17: pincode + radius serviceability. */
    deliveryRadiusKm: integer('delivery_radius_km'),
    /** D-12: per-store COD switch. */
    codEnabled: boolean('cod_enabled').notNull().default(true),

    minOrderPaise: paiseNotNull('min_order_paise'),
    avgPrepTimeMinutes: integer('avg_prep_time_minutes'),
    ratingAvg: percentage('rating_avg'),
    ratingCount: integer('rating_count').notNull().default(0),

    isAcceptingOrders: boolean('is_accepting_orders').notNull().default(false),
    closedUntil: ts('closed_until'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('stores_slug_key').on(table.slug),
    index('stores_vendor_idx').on(table.vendorId),
    index('stores_status_idx')
      .on(table.status)
      .where(sql`deleted_at is null`),
    index('stores_pincode_idx').on(table.pincode),
  ]
);

/** Multiple rows per day allow split shifts (lunch/dinner). */
export const storeHours = pgTable(
  'store_hours',
  {
    id: primaryId(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    dayOfWeek: smallint('day_of_week').notNull(),
    opensAt: time('opens_at'),
    closesAt: time('closes_at'),
    isClosed: boolean('is_closed').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index('store_hours_store_idx').on(table.storeId, table.dayOfWeek),
    check('store_hours_day_range', sql`${table.dayOfWeek} between 0 and 6`),
  ]
);

/** Which zones a store serves. */
export const storeDeliveryZones = pgTable(
  'store_delivery_zones',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    deliveryZoneId: uuid('delivery_zone_id')
      .notNull()
      .references(() => deliveryZones.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.storeId, table.deliveryZoneId] }),
    index('store_delivery_zones_zone_idx').on(table.deliveryZoneId),
  ]
);
