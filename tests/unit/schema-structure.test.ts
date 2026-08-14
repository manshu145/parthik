import { describe, expect, it } from 'vitest';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { is } from 'drizzle-orm';
import { PgEnumColumn } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';

/**
 * Schema structure validation (docs/DATABASE.md).
 *
 * These assertions exist because the conventions in §1 are only real if something
 * checks them. They introspect the actual Drizzle definitions, so a table added
 * later that forgets timestamps, uses a float for money, or omits a foreign-key
 * index will fail CI rather than reaching a migration.
 */

type TableEntry = { name: string; table: PgTable };

function allTables(): TableEntry[] {
  const entries: TableEntry[] = [];

  for (const [exportName, value] of Object.entries(schema)) {
    // pgTable instances expose a table config; enums and helpers do not.
    if (value && typeof value === 'object' && Symbol.for('drizzle:Name') in value) {
      try {
        const config = getTableConfig(value as PgTable);
        entries.push({ name: config.name, table: value as PgTable });
      } catch {
        // Not a table (enum, relation, etc.).
      }
      void exportName;
    }
  }

  return entries;
}

const tables = allTables();
const tableByName = new Map(tables.map((entry) => [entry.name, entry.table]));

function columnsOf(
  tableName: string
): Map<string, ReturnType<typeof getTableConfig>['columns'][number]> {
  const table = tableByName.get(tableName);
  if (!table) throw new Error(`Table "${tableName}" is not defined in the schema`);
  return new Map(getTableConfig(table).columns.map((column) => [column.name, column]));
}

// ---------------------------------------------------------------------------
// Coverage: every table the approved design requires must exist
// ---------------------------------------------------------------------------

/** Transcribed from docs/DATABASE.md §3–§11. */
const REQUIRED_TABLES = [
  // Identity §3
  'users',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'sessions',
  'otp_verifications',
  'login_attempts',
  'devices',
  // Customer §4
  'customer_profiles',
  'addresses',
  'wishlists',
  'wishlist_items',
  'customer_notification_preferences',
  // Marketplace §5
  'vendors',
  'vendor_users',
  'vendor_documents',
  'vendor_bank_accounts',
  'stores',
  'store_hours',
  'store_delivery_zones',
  'delivery_zones',
  'zone_pincodes',
  'categories',
  'brands',
  'products',
  'product_variants',
  'product_images',
  'inventory',
  'inventory_transactions',
  // Commerce §6
  'carts',
  'cart_items',
  'coupons',
  'coupon_restrictions',
  'coupon_usages',
  'promotions',
  'promotion_rules',
  'orders',
  'order_items',
  'order_status_history',
  'payments',
  'payment_events',
  'refunds',
  'invoices',
  'tax_rates',
  'cancellation_policies',
  // Delivery §8
  'drivers',
  'driver_zones',
  'driver_documents',
  'driver_vehicles',
  'deliveries',
  'delivery_assignments',
  'delivery_status_history',
  'delivery_proofs',
  'driver_earnings',
  'payout_batches',
  'driver_cash_ledger',
  'cash_deposits',
  // Engagement §9
  'reviews',
  'banners',
  'campaigns',
  'notification_templates',
  'notifications',
  'support_tickets',
  'ticket_messages',
  'faqs',
  // CMS / localisation §10
  'supported_locales',
  'cms_pages',
  'blog_posts',
  'home_layouts',
  'seo_meta',
  'redirects',
  'category_translations',
  'product_translations',
  'product_variant_translations',
  'brand_translations',
  'cms_page_translations',
  'blog_post_translations',
  'banner_translations',
  'faq_translations',
  'coupon_translations',
  'seo_meta_translations',
  'cancellation_reason_translations',
  // Administration §11
  'admin_settings',
  'feature_flags',
  'audit_logs',
  'system_events',
  'webhook_logs',
  'idempotency_keys',
] as const;

describe('schema coverage', () => {
  it('defines every table required by the approved design', () => {
    const missing = REQUIRED_TABLES.filter((name) => !tableByName.has(name));
    expect(missing, `Missing tables: ${missing.join(', ')}`).toEqual([]);
  });

  it('does NOT create analytics_events (D-28: GA4 owns event storage)', () => {
    expect(tableByName.has('analytics_events')).toBe(false);
  });

  it('has no unexpected extra tables beyond the design plus documented additions', () => {
    // `cancellation_reasons` is the base table the approved
    // `cancellation_reason_translations` requires but which §10.1 never defined.
    const documentedAdditions = ['cancellation_reasons'];
    const allowed = new Set<string>([...REQUIRED_TABLES, ...documentedAdditions]);
    const extra = tables.map((t) => t.name).filter((name) => !allowed.has(name));
    expect(extra, `Undocumented tables: ${extra.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §1 conventions
// ---------------------------------------------------------------------------

describe('conventions: primary keys and timestamps', () => {
  it('gives every table a uuid primary key named id, except join tables', () => {
    const compositeKeyTables = ['role_permissions', 'store_delivery_zones', 'driver_zones'];

    for (const { name, table } of tables) {
      if (compositeKeyTables.includes(name)) continue;
      const config = getTableConfig(table);
      const pk = config.columns.filter((column) => column.primary);

      expect(pk.length, `${name} should have exactly one primary key column`).toBe(1);
      expect(pk[0]?.name, `${name} primary key should be "id"`).toBe('id');
      expect(pk[0]?.getSQLType(), `${name}.id should be uuid`).toBe('uuid');
    }
  });

  it('gives every table a created_at', () => {
    const exempt = ['role_permissions', 'store_delivery_zones', 'driver_zones', 'inventory'];

    const missing = tables
      .filter(({ name }) => !exempt.includes(name))
      .filter(({ name }) => !columnsOf(name).has('created_at'))
      .map(({ name }) => name);

    expect(missing, `Tables without created_at: ${missing.join(', ')}`).toEqual([]);
  });

  it('uses timestamptz for every timestamp column', () => {
    const offenders: string[] = [];

    for (const { name, table } of tables) {
      for (const column of getTableConfig(table).columns) {
        const type = column.getSQLType();
        if (type.startsWith('timestamp') && !type.includes('with time zone')) {
          offenders.push(`${name}.${column.name} (${type})`);
        }
      }
    }

    expect(offenders, `Non-timestamptz columns: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('conventions: no duplicate column mappings', () => {
  it('maps every field in a table to a distinct database column', () => {
    /**
     * REGRESSION GUARD.
     *
     * A shared column helper makes it easy to write `declaredAt: createdAt()`
     * alongside a `...timestamps` spread, which silently maps two fields to the
     * same `created_at` column. That happened during TASK 002 and was caught by an
     * invariant test rather than by review, so it is now checked directly.
     */
    const offenders: string[] = [];

    for (const { name, table } of tables) {
      const seen = new Map<string, number>();
      for (const column of getTableConfig(table).columns) {
        seen.set(column.name, (seen.get(column.name) ?? 0) + 1);
      }
      for (const [columnName, occurrences] of seen) {
        if (occurrences > 1) offenders.push(`${name}.${columnName} (x${occurrences})`);
      }
    }

    expect(offenders, `Duplicate column mappings: ${offenders.join(', ')}`).toEqual([]);
  });

  it('names timestamp columns consistently with their field names', () => {
    // `declaredAt` must map to `declared_at`, not to something unrelated.
    const offenders: string[] = [];
    const expectedName = (field: string): string => field.replace(/([A-Z])/g, '_$1').toLowerCase();

    for (const { name, table } of tables) {
      for (const [field, column] of Object.entries(getTableConfig(table).columns)) {
        void field;
        void column;
      }
      // Drizzle exposes columns by field key on the table object itself.
      for (const [field, value] of Object.entries(table as unknown as Record<string, unknown>)) {
        if (!value || typeof value !== 'object' || !('name' in value)) continue;
        const columnName = (value as { name: unknown }).name;
        if (typeof columnName !== 'string') continue;
        if (!/At$/.test(field)) continue;
        if (columnName !== expectedName(field)) {
          offenders.push(`${name}.${field} -> ${columnName}`);
        }
      }
    }

    expect(offenders, `Misnamed timestamp columns: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('conventions: money is integer paise', () => {
  it('declares every *_paise column as bigint, never float or numeric', () => {
    const offenders: string[] = [];
    let paiseColumns = 0;

    for (const { name, table } of tables) {
      for (const column of getTableConfig(table).columns) {
        if (!column.name.endsWith('_paise')) continue;
        paiseColumns += 1;
        if (column.getSQLType() !== 'bigint') {
          offenders.push(`${name}.${column.name} (${column.getSQLType()})`);
        }
      }
    }

    // A float or numeric money column is the single most damaging schema mistake
    // available here, so it is asserted explicitly.
    expect(offenders, `Non-bigint money columns: ${offenders.join(', ')}`).toEqual([]);
    expect(paiseColumns).toBeGreaterThan(30);
  });

  it('has no column that stores money under a non-paise name', () => {
    /**
     * Only NUMERIC columns can hold money, so jsonb/boolean/text/timestamp
     * columns whose names merely contain a money-ish word are not candidates.
     */
    const numericTypes = ['bigint', 'integer', 'smallint', 'real', 'double precision'];
    const isNumeric = (type: string): boolean =>
      numericTypes.includes(type) || type.startsWith('numeric');

    /**
     * Documented exceptions — counters and one deliberately doc-named column.
     *
     * `coupons.discount_value` keeps the name from docs/DATABASE.md §6 even though
     * it holds paise for FLAT coupons and a percentage for PERCENTAGE coupons. That
     * dual meaning is the design's, not ours; it is interpreted by `coupon_type` in
     * the pricing module.
     */
    const exceptions = new Set([
      'coupons.discount_value',
      'coupons.usage_limit_total',
      'coupons.usage_limit_per_user',
      'customer_profiles.total_orders',
      'drivers.total_deliveries',
      'drivers.successful_deliveries',
      'cart_items.unit_price_paise_snapshot',
    ]);

    const moneyWord = /(amount|price|fee|mrp|payout|value)/;
    const allowedSuffix = /(_paise|_paise_snapshot|_rate|_percent|_count|_km)$/;

    const suspicious: string[] = [];

    for (const { name, table } of tables) {
      for (const column of getTableConfig(table).columns) {
        const qualified = `${name}.${column.name}`;
        if (exceptions.has(qualified)) continue;
        if (!isNumeric(column.getSQLType())) continue;
        if (!moneyWord.test(column.name)) continue;
        if (allowedSuffix.test(column.name)) continue;
        suspicious.push(`${qualified} (${column.getSQLType()})`);
      }
    }

    expect(suspicious, `Money-like columns not named *_paise: ${suspicious.join(', ')}`).toEqual(
      []
    );
  });
});

describe('conventions: soft delete', () => {
  it('applies deleted_at to the entities the design lists', () => {
    const shouldSoftDelete = [
      'users',
      'addresses',
      'vendors',
      'vendor_bank_accounts',
      'stores',
      'categories',
      'brands',
      'products',
      'product_variants',
      'coupons',
      'promotions',
      'banners',
      'drivers',
      'reviews',
      'cms_pages',
      'blog_posts',
    ];

    const missing = shouldSoftDelete.filter((name) => !columnsOf(name).has('deleted_at'));
    expect(missing, `Missing deleted_at: ${missing.join(', ')}`).toEqual([]);
  });

  it('NEVER soft-deletes financial or ledger rows', () => {
    // These are corrected by new rows, never erased (docs/DATABASE.md §1).
    const mustNotSoftDelete = [
      'orders',
      'order_items',
      'order_status_history',
      'payments',
      'payment_events',
      'refunds',
      'invoices',
      'audit_logs',
      'driver_earnings',
      'driver_cash_ledger',
      'cash_deposits',
      'inventory_transactions',
      'coupon_usages',
      'delivery_status_history',
    ];

    const offenders = mustNotSoftDelete.filter((name) => columnsOf(name).has('deleted_at'));
    expect(offenders, `Ledger tables must not be soft-deletable: ${offenders.join(', ')}`).toEqual(
      []
    );
  });
});

describe('conventions: foreign keys are indexed', () => {
  /**
   * PROVENANCE columns: "who did this", written once and never used as a query
   * predicate. Indexing them would add write cost on every insert for a lookup
   * nobody performs — the audit trail is queried via `audit_logs`, which IS
   * indexed by actor.
   */
  const provenanceColumns = new Set([
    'created_by',
    'updated_by',
    'approved_by',
    'reviewed_by',
    'moderated_by',
    'verified_by',
    'assigned_by',
    'granted_by',
    'invited_by',
    'initiated_by',
    'published_by',
    'author_user_id',
    'changed_by_user_id',
  ]);

  /**
   * 1:1 metadata pointers, always traversed FROM the owning entity. `seo_meta`
   * additionally has a unique (entity_type, entity_id) index, so the reverse
   * lookup is already covered.
   */
  const metadataPointers = new Set(['seo_meta_id', 'active_role_id']);

  it('indexes every foreign key that is a real traversal path', () => {
    const offenders: string[] = [];

    for (const { name, table } of tables) {
      const config = getTableConfig(table);

      const covered = new Set<string>();
      for (const index of config.indexes) {
        for (const column of index.config.columns) {
          if ('name' in column && typeof column.name === 'string') covered.add(column.name);
        }
      }
      for (const constraint of config.uniqueConstraints) {
        for (const column of constraint.columns) covered.add(column.name);
      }
      for (const column of config.columns) {
        if (column.primary) covered.add(column.name);
      }
      for (const pk of config.primaryKeys) {
        for (const column of pk.columns) covered.add(column.name);
      }

      for (const fk of config.foreignKeys) {
        for (const column of fk.reference().columns) {
          if (covered.has(column.name)) continue;
          if (provenanceColumns.has(column.name)) continue;
          if (metadataPointers.has(column.name)) continue;
          offenders.push(`${name}.${column.name}`);
        }
      }
    }

    // Unindexed traversal FKs make joins and cascading deletes slow in ways that
    // only appear under real data volume (docs/DATABASE.md §1).
    expect(offenders, `Unindexed foreign keys: ${offenders.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

describe('enums', () => {
  it('matches the approved order_status set exactly', () => {
    expect([...schema.orderStatus.enumValues]).toEqual([
      'PENDING_PAYMENT',
      'CONFIRMED',
      'ACCEPTED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'ASSIGNED',
      'PICKED_UP',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
      'PAYMENT_FAILED',
      'REFUNDED',
      'RETURNED',
      'FAILED_DELIVERY',
    ]);
  });

  it('matches the approved delivery_status set exactly', () => {
    expect([...schema.deliveryStatus.enumValues]).toEqual([
      'PENDING_ASSIGNMENT',
      'OFFERED',
      'ASSIGNED',
      'EN_ROUTE_TO_STORE',
      'AT_STORE',
      'PICKED_UP',
      'EN_ROUTE_TO_CUSTOMER',
      'AT_CUSTOMER',
      'DELIVERED',
      'FAILED',
      'CANCELLED',
      'RETURNED_TO_STORE',
    ]);
  });

  it('offers UPI, Card and COD as payment methods (D-12)', () => {
    for (const method of ['UPI', 'CARD', 'COD']) {
      expect(schema.paymentMethod.enumValues).toContain(method);
    }
  });

  it('supports exactly en and hi locales (D-33)', () => {
    expect([...schema.localeCode.enumValues]).toEqual(['en', 'hi']);
  });

  it('defines the COD cash entry types (D-12)', () => {
    expect([...schema.cashEntryType.enumValues]).toEqual([
      'COLLECTION',
      'DEPOSIT',
      'ADJUSTMENT',
      'WRITE_OFF',
    ]);
  });

  it('defines dispatch modes for D-18 measurability', () => {
    expect([...schema.dispatchMode.enumValues]).toEqual(['AUTO_NEAREST', 'BROADCAST', 'MANUAL']);
  });

  it('uses native enum columns rather than free text for closed sets', () => {
    // A status stored as text is a status that will eventually hold a typo.
    const shouldBeEnum: Array<[string, string]> = [
      ['orders', 'status'],
      ['orders', 'payment_method'],
      ['orders', 'payment_status'],
      ['deliveries', 'status'],
      ['payments', 'status'],
      ['products', 'status'],
      ['users', 'status'],
      ['driver_cash_ledger', 'entry_type'],
      ['cash_deposits', 'status'],
      ['delivery_assignments', 'dispatch_mode'],
      ['product_translations', 'locale'],
      ['notification_templates', 'locale'],
    ];

    for (const [tableName, columnName] of shouldBeEnum) {
      const column = columnsOf(tableName).get(columnName);
      expect(column, `${tableName}.${columnName} should exist`).toBeDefined();
      expect(is(column!, PgEnumColumn), `${tableName}.${columnName} should be an enum`).toBe(true);
    }
  });
});
