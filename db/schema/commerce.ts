import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  paise,
  paiseNotNull,
  percentage,
  primaryId,
  primaryId as id,
  timestamps,
  ts,
} from './_helpers';
import { orderSource, orderStatus, paymentMethod, paymentStatus } from './enums';
import { users } from './identity';
import { addresses } from './customer';
import { deliveryZones } from './location';
import { productVariants, products } from './catalog';
import { stores, vendors } from './marketplace';
import { coupons } from './marketing';

/**
 * Commerce domain (docs/DATABASE.md §6).
 *
 * D-11 approved: SINGLE VENDOR PER ORDER. `carts.store_id` and `orders.store_id`
 * are single-valued, and mixing vendors is rejected with MIXED_VENDOR_CART. There
 * is deliberately no order-group parent table in V1.
 */

export const carts = pgTable(
  'carts',
  {
    id: primaryId(),
    /** NULL for a guest cart, which is keyed by `guest_token` instead. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    guestToken: text('guest_token'),

    /** D-11: one store per cart. */
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'set null' }),
    deliveryZoneId: uuid('delivery_zone_id').references(() => deliveryZones.id, {
      onDelete: 'set null',
    }),
    addressId: uuid('address_id').references(() => addresses.id, { onDelete: 'set null' }),
    appliedCouponId: uuid('applied_coupon_id').references(() => coupons.id, {
      onDelete: 'set null',
    }),

    currency: text('currency').notNull().default('INR'),
    /** When totals were last recomputed; totals themselves are never trusted. */
    lastPricedAt: ts('last_priced_at'),
    expiresAt: ts('expires_at'),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('carts_user_key')
      .on(table.userId)
      .where(sql`user_id is not null`),
    uniqueIndex('carts_guest_key')
      .on(table.guestToken)
      .where(sql`guest_token is not null`),
    index('carts_store_idx').on(table.storeId),
    index('carts_zone_idx').on(table.deliveryZoneId),
    index('carts_address_idx').on(table.addressId),
    index('carts_coupon_idx').on(table.appliedCouponId),
    index('carts_expiry_idx').on(table.expiresAt),
    check(
      'carts_owner_present',
      sql`${table.userId} is not null or ${table.guestToken} is not null`
    ),
  ]
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: primaryId(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),

    /**
     * Snapshot taken at add-to-cart. Exists to DETECT a price change and warn the
     * customer — the authoritative price at checkout is re-read from the variant.
     */
    unitPricePaiseSnapshot: paiseNotNull('unit_price_paise_snapshot'),

    addedAt: ts('added_at').notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('cart_items_variant_key').on(table.cartId, table.variantId),
    index('cart_items_cart_idx').on(table.cartId),
    index('cart_items_product_idx').on(table.productId),
    check('cart_items_quantity_positive', sql`${table.quantity} > 0`),
  ]
);

/**
 * Orders — the financial snapshot. Never soft-deleted and never mutated in a way
 * that loses history.
 *
 * Payment-method entry paths differ (D-12): UPI/Card start at PENDING_PAYMENT and
 * reach CONFIRMED only via a verified webhook, while COD is created CONFIRMED
 * because there is no upstream payment to wait for.
 */
export const orders = pgTable(
  'orders',
  {
    id: primaryId(),
    /** Human reference, e.g. PK-2026-000123. Spoken aloud in support calls. */
    orderNumber: text('order_number').notNull(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),

    status: orderStatus('status').notNull(),

    /**
     * Frozen copy of the delivery address. Deliberate: an order must remain
     * readable and disputable even if the customer later edits or deletes it.
     */
    deliveryAddressSnapshot: jsonb('delivery_address_snapshot').notNull(),
    contactPhone: text('contact_phone').notNull(),
    contactName: text('contact_name').notNull(),

    deliveryZoneId: uuid('delivery_zone_id').references(() => deliveryZones.id, {
      onDelete: 'set null',
    }),

    // ---- Money: the explicit, auditable pattern from §1.1 ----
    grossAmountPaise: paiseNotNull('gross_amount_paise'),
    itemDiscountPaise: paiseNotNull('item_discount_paise'),
    couponId: uuid('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
    /** Snapshot so a renamed or deleted coupon still explains the discount. */
    couponCodeSnapshot: text('coupon_code_snapshot'),
    couponDiscountPaise: paiseNotNull('coupon_discount_paise'),

    // ---- Tax: D-14 BLOCKED. Columns exist and are written as 0. ----
    taxableAmountPaise: paiseNotNull('taxable_amount_paise'),
    taxAmountPaise: paiseNotNull('tax_amount_paise'),

    deliveryFeePaise: paiseNotNull('delivery_fee_paise'),
    packagingFeePaise: paiseNotNull('packaging_fee_paise'),
    serviceFeePaise: paiseNotNull('service_fee_paise'),
    /** The single number the customer pays. */
    totalAmountPaise: paiseNotNull('total_amount_paise'),
    currency: text('currency').notNull().default('INR'),

    paymentMethod: paymentMethod('payment_method').notNull(),
    paymentStatus: paymentStatus('payment_status').notNull(),
    /** D-12. */
    isCod: boolean('is_cod').notNull().default(false),
    /** Authoritative amount to collect at the door; deliveries snapshot it. */
    codAmountPaise: paise('cod_amount_paise'),

    placedAt: ts('placed_at'),
    confirmedAt: ts('confirmed_at'),
    acceptedAt: ts('accepted_at'),
    readyAt: ts('ready_at'),
    deliveredAt: ts('delivered_at'),
    cancelledAt: ts('cancelled_at'),

    cancellationReason: text('cancellation_reason'),
    cancelledByRole: text('cancelled_by_role'),

    estimatedDeliveryAt: ts('estimated_delivery_at'),
    actualDeliveryMinutes: integer('actual_delivery_minutes'),

    customerNote: text('customer_note'),
    /** Never shown to the customer. */
    internalNote: text('internal_note'),

    /** Makes repeated clicks and network retries safe (master spec §12). */
    idempotencyKey: text('idempotency_key').notNull(),
    source: orderSource('source').notNull().default('WEB'),

    // ---- D-15: calculated, settled manually. No automated money movement. ----
    vendorPayoutPaise: paise('vendor_payout_paise'),
    platformCommissionPaise: paise('platform_commission_paise'),

    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('orders_number_key').on(table.orderNumber),
    uniqueIndex('orders_idempotency_key').on(table.idempotencyKey),
    index('orders_user_idx').on(table.userId, table.createdAt),
    index('orders_store_status_idx').on(table.storeId, table.status, table.createdAt),
    index('orders_status_idx').on(table.status, table.createdAt),
    index('orders_zone_idx').on(table.deliveryZoneId, table.createdAt),
    index('orders_vendor_idx').on(table.vendorId, table.createdAt),
    index('orders_coupon_idx').on(table.couponId),
    // Reconciliation sweep for orders stuck awaiting payment.
    index('orders_pending_payment_idx')
      .on(table.createdAt)
      .where(sql`status = 'PENDING_PAYMENT'`),

    check('orders_total_non_negative', sql`${table.totalAmountPaise} >= 0`),
    // A COD order must carry an amount to collect, and a prepaid order must not.
    check(
      'orders_cod_amount_consistent',
      sql`(${table.isCod} = false and ${table.codAmountPaise} is null)
          or (${table.isCod} = true and ${table.codAmountPaise} is not null)`
    ),
  ]
);

/**
 * Order lines. EVERYTHING is snapshotted: a product rename, reprice or delete
 * must never alter a historical invoice.
 */
export const orderItems = pgTable(
  'order_items',
  {
    id: primaryId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),

    // ---- Snapshots (§6 order_items) ----
    productNameSnapshot: text('product_name_snapshot').notNull(),
    variantLabelSnapshot: text('variant_label_snapshot'),
    imageKeySnapshot: text('image_key_snapshot'),
    unitLabelSnapshot: text('unit_label_snapshot'),
    /** D-14 BLOCKED: captured for future invoices, currently NULL. */
    hsnSnapshot: text('hsn_snapshot'),
    skuSnapshot: text('sku_snapshot'),

    quantity: integer('quantity').notNull(),
    mrpPaise: paiseNotNull('mrp_paise'),
    unitPricePaise: paiseNotNull('unit_price_paise'),
    itemDiscountPaise: paiseNotNull('item_discount_paise'),

    /** D-14 BLOCKED: written as 0 until a real TaxStrategy exists. */
    taxRate: percentage('tax_rate'),
    taxAmountPaise: paiseNotNull('tax_amount_paise'),

    lineTotalPaise: paiseNotNull('line_total_paise'),
    vendorPayoutPaise: paise('vendor_payout_paise'),

    createdAt: createdAt(),
  },
  (table) => [
    index('order_items_order_idx').on(table.orderId),
    index('order_items_product_idx').on(table.productId),
    index('order_items_variant_idx').on(table.variantId),
    check('order_items_quantity_positive', sql`${table.quantity} > 0`),
  ]
);

/**
 * Every status transition, without exception (master spec §13). Append-only.
 */
export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: primaryId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    /** NULL on the first row, where there is no prior status. */
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status').notNull(),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    changedByRole: text('changed_by_role'),
    reason: text('reason'),
    note: text('note'),
    metadata: jsonb('metadata'),
    createdAt: createdAt(),
  },
  (table) => [
    index('order_status_history_order_idx').on(table.orderId, table.createdAt),
    index('order_status_history_status_idx').on(table.toStatus, table.createdAt),
  ]
);

/**
 * Coupon redemption record.
 *
 * The unique constraint on (coupon_id, order_id) is what makes per-user limits
 * race-safe rather than advisory: two concurrent checkouts cannot both record a
 * redemption for the same order.
 */
export const couponUsages = pgTable(
  'coupon_usages',
  {
    id: id(),
    couponId: uuid('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    discountAppliedPaise: paiseNotNull('discount_applied_paise'),
    usedAt: ts('used_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('coupon_usages_order_key').on(table.couponId, table.orderId),
    index('coupon_usages_user_idx').on(table.couponId, table.userId),
  ]
);
