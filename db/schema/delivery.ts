import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  latitude,
  longitude,
  paise,
  paiseNotNull,
  percentage,
  primaryId,
  softDelete,
  timestamps,
  ts,
} from './_helpers';
import {
  assignmentResponse,
  cashDepositMethod,
  cashDepositStatus,
  cashEntryType,
  codCollectionMethod,
  deliveryStatus,
  dispatchMode,
  driverAvailability,
  driverDocType,
  driverStatus,
  earningType,
  kycStatus,
  proofType,
  vehicleType,
} from './enums';
import { users } from './identity';
import { deliveryZones } from './location';
import { stores } from './marketplace';
import { orders } from './commerce';
import { payoutBatches } from './payments';

/**
 * Delivery domain (docs/DATABASE.md §8).
 *
 * Two approved decisions shape this heavily:
 *   D-18 auto-nearest dispatch with offer timeout and fallback reassignment
 *   D-20 delivery OTP mandatory, photo/signature as an exception mechanism
 *   D-12 COD cash custody chain
 */

export const drivers = pgTable(
  'drivers',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    driverCode: text('driver_code').notNull(),

    status: driverStatus('status').notNull().default('APPLIED'),
    availability: driverAvailability('availability').notNull().default('OFFLINE'),

    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    dateOfBirth: date('date_of_birth'),
    emergencyContact: text('emergency_contact'),

    ratingAvg: percentage('rating_avg'),
    ratingCount: integer('rating_count').notNull().default(0),
    totalDeliveries: integer('total_deliveries').notNull().default(0),
    successfulDeliveries: integer('successful_deliveries').notNull().default(0),

    /**
     * EPHEMERAL current position (D-29 + clarification C-1).
     *
     * Required by auto-nearest dispatch. A single overwritten row with NO history:
     * it is CLEARED when availability becomes OFFLINE, so no long-term movement
     * trail of any driver is ever retained. The active-delivery trail lives in
     * `delivery_status_history` and is purged after 7 days.
     *
     * `cash_in_hand` is deliberately NOT a column — it is derived by summing
     * `driver_cash_ledger`, so it cannot drift from its ledger.
     */
    currentLatitude: latitude('current_latitude'),
    currentLongitude: longitude('current_longitude'),
    locationUpdatedAt: ts('location_updated_at'),

    approvedAt: ts('approved_at'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    rejectionReason: text('rejection_reason'),
    suspendedAt: ts('suspended_at'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('drivers_user_key').on(table.userId),
    uniqueIndex('drivers_code_key').on(table.driverCode),
    index('drivers_status_idx')
      .on(table.status)
      .where(sql`deleted_at is null`),
    // The dispatch candidate scan (D-18): online, approved, position known.
    index('drivers_dispatch_idx')
      .on(table.availability, table.status)
      .where(sql`availability = 'ONLINE' and status = 'APPROVED' and current_latitude is not null`),
  ]
);

export const driverZones = pgTable(
  'driver_zones',
  {
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    deliveryZoneId: uuid('delivery_zone_id')
      .notNull()
      .references(() => deliveryZones.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.driverId, table.deliveryZoneId] }),
    index('driver_zones_zone_idx').on(table.deliveryZoneId),
  ]
);

export const driverDocuments = pgTable(
  'driver_documents',
  {
    id: primaryId(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    docType: driverDocType('doc_type').notNull(),

    /** PRIVATE R2 bucket. */
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    /** Encrypted at rest; only a masked form is ever displayed. */
    documentNumberEncrypted: text('document_number_encrypted'),

    kycStatus: kycStatus('kyc_status').notNull().default('PENDING'),
    /** An expired mandatory document must block going online and dispatch. */
    expiresAt: ts('expires_at'),

    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: ts('reviewed_at'),
    rejectionReason: text('rejection_reason'),
    ...timestamps,
  },
  (table) => [
    index('driver_documents_driver_idx').on(table.driverId),
    index('driver_documents_expiry_idx')
      .on(table.expiresAt)
      .where(sql`expires_at is not null`),
    index('driver_documents_status_idx').on(table.kycStatus),
  ]
);

export const driverVehicles = pgTable(
  'driver_vehicles',
  {
    id: primaryId(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    vehicleType: vehicleType('vehicle_type').notNull(),
    registrationNumber: text('registration_number'),
    makeModel: text('make_model'),
    insuranceExpiry: date('insurance_expiry'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index('driver_vehicles_driver_idx').on(table.driverId),
    uniqueIndex('driver_vehicles_active_key')
      .on(table.driverId)
      .where(sql`is_active = true`),
  ]
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: primaryId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),

    status: deliveryStatus('status').notNull().default('PENDING_ASSIGNMENT'),
    deliveryZoneId: uuid('delivery_zone_id').references(() => deliveryZones.id, {
      onDelete: 'set null',
    }),

    pickupAddressSnapshot: jsonb('pickup_address_snapshot').notNull(),
    dropAddressSnapshot: jsonb('drop_address_snapshot').notNull(),

    distanceKm: numeric('distance_km', { precision: 6, scale: 2 }),
    deliveryFeePaise: paiseNotNull('delivery_fee_paise'),
    driverPayoutPaise: paise('driver_payout_paise'),

    /**
     * D-20: delivery OTP is MANDATORY for every delivery, and hashed like any
     * other OTP. Photo/signature is an exception mechanism, never the primary path.
     */
    deliveryOtpHash: text('delivery_otp_hash').notNull(),
    otpVerifiedAt: ts('otp_verified_at'),
    otpAttempts: integer('otp_attempts').notNull().default(0),
    otpRegeneratedCount: integer('otp_regenerated_count').notNull().default(0),

    assignedAt: ts('assigned_at'),
    acceptedAt: ts('accepted_at'),
    reachedStoreAt: ts('reached_store_at'),
    pickedUpAt: ts('picked_up_at'),
    reachedCustomerAt: ts('reached_customer_at'),
    deliveredAt: ts('delivered_at'),
    failedAt: ts('failed_at'),
    failureReason: text('failure_reason'),

    /**
     * COD (D-12). `orders.cod_amount_paise` is authoritative; this is a SNAPSHOT
     * taken at assignment so a later order edit cannot retroactively change what
     * the driver was told to collect. There is deliberately no
     * `deliveries.cod_amount_paise`.
     */
    codExpectedPaise: paise('cod_expected_paise'),
    codCollectedPaise: paise('cod_collected_paise'),
    codCollectionMethod: codCollectionMethod('cod_collection_method'),
    codCollectedAt: ts('cod_collected_at'),
    /** Mismatch is RECORDED, never silently swallowed. */
    codVariancePaise: paise('cod_variance_paise'),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('deliveries_order_key').on(table.orderId),
    index('deliveries_driver_idx').on(table.driverId, table.status),
    index('deliveries_store_idx').on(table.storeId, table.status),
    // The dispatch board: unassigned deliveries in a zone.
    index('deliveries_pending_idx')
      .on(table.deliveryZoneId, table.createdAt)
      .where(sql`status = 'PENDING_ASSIGNMENT'`),
    index('deliveries_status_idx').on(table.status, table.createdAt),
    // Variance reporting for COD reconciliation.
    index('deliveries_cod_variance_idx')
      .on(table.codCollectedAt)
      .where(sql`cod_variance_paise is not null and cod_variance_paise <> 0`),
  ]
);

/**
 * Full offer/accept/decline audit (D-18).
 *
 * `attempt_number` and `distance_at_offer_km` exist so dispatch quality is
 * measurable — without them, "why was a far driver assigned?" is unanswerable.
 */
export const deliveryAssignments = pgTable(
  'delivery_assignments',
  {
    id: primaryId(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),

    offeredAt: ts('offered_at').notNull().defaultNow(),
    respondedAt: ts('responded_at'),
    response: assignmentResponse('response'),
    declineReason: text('decline_reason'),
    offerExpiresAt: ts('offer_expires_at'),

    /** Set when an admin assigns manually rather than the dispatcher offering. */
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    attemptNumber: smallint('attempt_number').notNull().default(1),
    dispatchMode: dispatchMode('dispatch_mode').notNull().default('AUTO_NEAREST'),
    /** Road distance from Route Matrix at offer time, for dispatch analytics. */
    distanceAtOfferKm: numeric('distance_at_offer_km', { precision: 6, scale: 2 }),

    ...timestamps,
  },
  (table) => [
    index('delivery_assignments_driver_idx').on(table.driverId, table.response, table.offeredAt),
    uniqueIndex('delivery_assignments_attempt_key').on(table.deliveryId, table.attemptNumber),
    // The driver's open-offer queue.
    index('delivery_assignments_open_idx')
      .on(table.driverId, table.offerExpiresAt)
      .where(sql`response is null`),
  ]
);

/**
 * Delivery status trail. Coordinates here are the ACTIVE-DELIVERY trail and are
 * purged after 7 days (D-29).
 */
export const deliveryStatusHistory = pgTable(
  'delivery_status_history',
  {
    id: primaryId(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    fromStatus: deliveryStatus('from_status'),
    toStatus: deliveryStatus('to_status').notNull(),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    changedByRole: text('changed_by_role'),
    latitude: latitude(),
    longitude: longitude(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (table) => [
    index('delivery_status_history_delivery_idx').on(table.deliveryId, table.createdAt),
    // Drives the 7-day location purge job.
    index('delivery_status_history_purge_idx')
      .on(table.createdAt)
      .where(sql`latitude is not null`),
  ]
);

export const deliveryProofs = pgTable(
  'delivery_proofs',
  {
    id: primaryId(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    proofType: proofType('proof_type').notNull(),
    /** PRIVATE R2 bucket; NULL for OTP-only proof. */
    storageKey: text('storage_key'),
    otpVerified: boolean('otp_verified').notNull().default(false),
    recipientName: text('recipient_name'),
    notes: text('notes'),
    latitude: latitude(),
    longitude: longitude(),
    capturedAt: ts('captured_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('delivery_proofs_delivery_idx').on(table.deliveryId),
    // Exception-rate monitoring: photo/signature used instead of OTP.
    index('delivery_proofs_exception_idx')
      .on(table.proofType, table.createdAt)
      .where(sql`proof_type <> 'OTP'`),
  ]
);

/**
 * Append-only earnings ledger. Balance is derived by summation, never stored as a
 * mutable field.
 */
export const driverEarnings = pgTable(
  'driver_earnings',
  {
    id: primaryId(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    deliveryId: uuid('delivery_id').references(() => deliveries.id, { onDelete: 'set null' }),
    earningType: earningType('earning_type').notNull(),
    /** Signed: penalties are negative. */
    amountPaise: paiseNotNull('amount_paise'),
    description: text('description'),
    earnedOn: date('earned_on').notNull(),
    payoutBatchId: uuid('payout_batch_id').references(() => payoutBatches.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('driver_earnings_driver_idx').on(table.driverId, table.earnedOn),
    index('driver_earnings_batch_idx').on(table.payoutBatchId),
    index('driver_earnings_delivery_idx').on(table.deliveryId),
  ]
);

// ---------------------------------------------------------------------------
// COD cash custody chain (D-12, docs/DATABASE.md §6.2)
// ---------------------------------------------------------------------------

/**
 * Two-step deposit: a driver DECLARES, an admin VERIFIES. A declared deposit is
 * not a settled deposit, and the variance between declared and verified is
 * recorded rather than reconciled away.
 *
 * Separation of duties matters here — `cash:reconcile` and `cash:adjust` are
 * deliberately distinct permissions (docs/SECURITY.md §5.2).
 */
export const cashDeposits = pgTable(
  'cash_deposits',
  {
    id: primaryId(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    depositReference: text('deposit_reference').notNull(),

    declaredAmountPaise: paiseNotNull('declared_amount_paise'),
    verifiedAmountPaise: paise('verified_amount_paise'),
    variancePaise: paise('variance_paise'),

    method: cashDepositMethod('method').notNull(),
    /** PRIVATE R2 bucket: deposit slip or transfer screenshot. */
    proofStorageKey: text('proof_storage_key'),
    status: cashDepositStatus('status').notNull().default('DECLARED'),

    declaredAt: ts('declared_at').notNull().defaultNow(),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),
    verifiedAt: ts('verified_at'),
    rejectionReason: text('rejection_reason'),
    notes: text('notes'),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('cash_deposits_reference_key').on(table.depositReference),
    index('cash_deposits_driver_idx').on(table.driverId, table.declaredAt),
    // The admin verification queue.
    index('cash_deposits_pending_idx')
      .on(table.declaredAt)
      .where(sql`status = 'DECLARED'`),
    check('cash_deposits_declared_positive', sql`${table.declaredAmountPaise} > 0`),
  ]
);

/**
 * Append-only cash ledger. Cash in hand is DERIVED by summation, never stored as
 * a mutable field — the same discipline as driver earnings, and the reason a
 * balance cannot be silently overwritten.
 */
export const driverCashLedger = pgTable(
  'driver_cash_ledger',
  {
    id: primaryId(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    entryType: cashEntryType('entry_type').notNull(),
    /** Signed: + on collection, − on deposit. */
    amountPaise: paiseNotNull('amount_paise'),

    deliveryId: uuid('delivery_id').references(() => deliveries.id, { onDelete: 'set null' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    cashDepositId: uuid('cash_deposit_id').references(() => cashDeposits.id, {
      onDelete: 'set null',
    }),

    reason: text('reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('driver_cash_ledger_driver_idx').on(table.driverId, table.createdAt),
    index('driver_cash_ledger_deposit_idx').on(table.cashDepositId),
    index('driver_cash_ledger_delivery_idx').on(table.deliveryId),
    index('driver_cash_ledger_order_idx').on(table.orderId),

    /**
     * IDEMPOTENCY GUARD (§6.2).
     *
     * A retried delivery confirmation cannot record the same cash twice: the
     * second insert violates this index instead of inflating the driver's
     * liability. This is the database-level protection behind the
     * cash-collected/payment-paid invariant.
     */
    uniqueIndex('driver_cash_ledger_collection_key')
      .on(table.deliveryId, table.entryType)
      .where(sql`entry_type = 'COLLECTION'`),
  ]
);
