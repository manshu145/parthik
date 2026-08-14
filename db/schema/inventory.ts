import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps, updatedAt } from './_helpers';
import { inventoryReferenceType, inventoryTxnType } from './enums';
import { productVariants } from './catalog';
import { stores } from './marketplace';
import { users } from './identity';

/**
 * Inventory (docs/DATABASE.md §6.1, decision D-16).
 *
 * D-16 approved: **reserve at order/payment initiation, release on payment
 * failure or cancellation.** Reservation is what stops two customers paying for
 * the same last unit while one of them is still in the gateway.
 *
 * `quantity_available` is what may still be sold and is decremented at
 * reservation time. `quantity_reserved` is committed-but-not-yet-delivered.
 */
export const inventory = pgTable(
  'inventory',
  {
    id: primaryId(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),

    quantityAvailable: integer('quantity_available').notNull().default(0),
    quantityReserved: integer('quantity_reserved').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(0),

    trackInventory: boolean('track_inventory').notNull().default(true),
    allowBackorder: boolean('allow_backorder').notNull().default(false),

    updatedAt: updatedAt(),
    /** Optimistic locking; reserve/release additionally take a row lock. */
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('inventory_variant_key').on(table.variantId),
    index('inventory_store_idx').on(table.storeId),
    // Low-stock reporting for the vendor dashboard.
    index('inventory_low_stock_idx')
      .on(table.storeId)
      .where(sql`track_inventory = true and quantity_available <= low_stock_threshold`),

    /**
     * Overselling is impossible at the DATABASE level, not merely unlikely
     * (§6.1 rule 2). An application bug becomes a failed transaction rather than
     * a customer paying for stock that does not exist.
     */
    check('inventory_available_non_negative', sql`${table.quantityAvailable} >= 0`),
    check('inventory_reserved_non_negative', sql`${table.quantityReserved} >= 0`),
  ]
);

/**
 * Append-only stock ledger. Current quantity must always be reproducible from
 * it, so a counter that disagrees with its ledger is a detectable bug (§6.1
 * rule 3).
 *
 * Never soft-deleted — this is a ledger, corrected by new rows.
 */
export const inventoryTransactions = pgTable(
  'inventory_transactions',
  {
    id: primaryId(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),

    txnType: inventoryTxnType('txn_type').notNull(),
    /** Signed: negative reduces available stock. */
    quantityDelta: integer('quantity_delta').notNull(),
    /** Snapshot of the resulting available quantity, for ledger reconciliation. */
    quantityAfter: integer('quantity_after').notNull(),

    referenceType: inventoryReferenceType('reference_type').notNull(),
    referenceId: uuid('reference_id'),
    reason: text('reason'),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    index('inventory_transactions_variant_idx').on(table.variantId, table.createdAt),
    index('inventory_transactions_reference_idx').on(table.referenceType, table.referenceId),
    index('inventory_transactions_store_idx').on(table.storeId, table.createdAt),

    /**
     * IDEMPOTENCY GUARD (§6.1 rule 4).
     *
     * `RESERVE`, `RELEASE` and `SALE` may each occur at most once per order per
     * variant. A retried cancellation or a duplicated queue message therefore
     * cannot release the same stock twice and inflate inventory — the second
     * insert violates this index instead of silently corrupting the count.
     */
    uniqueIndex('inventory_transactions_order_movement_key')
      .on(table.referenceId, table.variantId, table.txnType)
      .where(sql`reference_type = 'ORDER' and txn_type in ('RESERVE', 'RELEASE', 'SALE')`),
  ]
);
