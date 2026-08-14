import { describe, expect, it } from 'vitest';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';

/**
 * Schema invariant tests.
 *
 * The previous suite checks conventions. This one checks the specific structures
 * that PROTECT MONEY AND STOCK — the guards that make double-spending,
 * double-releasing and lost history impossible at the database level rather than
 * merely unlikely in application code.
 *
 * If one of these fails, a real safety property has been removed.
 */

function config(table: PgTable) {
  return getTableConfig(table);
}

function columnNames(table: PgTable): string[] {
  return config(table).columns.map((column) => column.name);
}

function indexNames(table: PgTable): string[] {
  return [
    ...config(table).indexes.map((index) => index.config.name ?? ''),
    ...config(table).uniqueConstraints.map((constraint) => constraint.name ?? ''),
  ];
}

function uniqueIndexes(table: PgTable) {
  return config(table).indexes.filter((index) => index.config.unique);
}

function checkNames(table: PgTable): string[] {
  return config(table).checks.map((check) => check.name);
}

// ---------------------------------------------------------------------------
// Inventory reservation (D-16)
// ---------------------------------------------------------------------------

describe('inventory reservation (D-16)', () => {
  it('tracks available and reserved quantities separately', () => {
    const columns = columnNames(schema.inventory);
    expect(columns).toContain('quantity_available');
    expect(columns).toContain('quantity_reserved');
  });

  it('makes overselling impossible with a database check constraint', () => {
    // docs/DATABASE.md §6.1 rule 2: this must be a constraint, not an
    // application assumption.
    const checks = checkNames(schema.inventory);
    expect(checks).toContain('inventory_available_non_negative');
    expect(checks).toContain('inventory_reserved_non_negative');
  });

  it('carries a version column for optimistic locking', () => {
    expect(columnNames(schema.inventory)).toContain('version');
  });

  it('supports RESERVE, RELEASE and SALE ledger movements', () => {
    for (const type of ['RESERVE', 'RELEASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE']) {
      expect(schema.inventoryTxnType.enumValues).toContain(type);
    }
  });

  it('enforces RELEASE idempotency with a unique partial index', () => {
    /**
     * §6.1 rule 4. Without this, a retried cancellation or duplicated queue
     * message would release the same stock twice and silently inflate inventory —
     * which reads as free stock and oversells.
     */
    const unique = uniqueIndexes(schema.inventoryTransactions);
    const guard = unique.find(
      (index) => index.config.name === 'inventory_transactions_order_movement_key'
    );

    expect(guard, 'inventory reservation idempotency guard must exist').toBeDefined();
    // Partial: scoped to ORDER-referenced RESERVE/RELEASE/SALE rows only, so
    // manual adjustments are still free to repeat.
    expect(guard?.config.where).toBeDefined();

    const columns = guard?.config.columns.map((column) => ('name' in column ? column.name : ''));
    expect(columns).toEqual(['reference_id', 'variant_id', 'txn_type']);
  });

  it('records quantity_after so stock is reproducible from the ledger', () => {
    // §6.1 rule 3: a counter that disagrees with its ledger is a detectable bug.
    expect(columnNames(schema.inventoryTransactions)).toContain('quantity_after');
  });
});

// ---------------------------------------------------------------------------
// COD cash custody (D-12)
// ---------------------------------------------------------------------------

describe('COD cash ledger (D-12)', () => {
  it('does NOT store cash_in_hand as a mutable column', () => {
    /**
     * Cash in hand is DERIVED by summing the ledger. A stored balance can be
     * overwritten and can drift from its own history, which is exactly the
     * failure mode a cash ledger exists to prevent.
     */
    expect(columnNames(schema.drivers)).not.toContain('cash_in_hand_paise');
    expect(columnNames(schema.drivers)).not.toContain('cash_in_hand');
  });

  it('enforces collection idempotency per delivery', () => {
    // A retried delivery confirmation must not record the same cash twice.
    const guard = uniqueIndexes(schema.driverCashLedger).find(
      (index) => index.config.name === 'driver_cash_ledger_collection_key'
    );

    expect(guard, 'cash collection idempotency guard must exist').toBeDefined();
    expect(guard?.config.where, 'guard must be scoped to COLLECTION entries').toBeDefined();

    const columns = guard?.config.columns.map((column) => ('name' in column ? column.name : ''));
    expect(columns).toEqual(['delivery_id', 'entry_type']);
  });

  it('links a ledger entry to its delivery, order and deposit', () => {
    const columns = columnNames(schema.driverCashLedger);
    expect(columns).toContain('delivery_id');
    expect(columns).toContain('order_id');
    expect(columns).toContain('cash_deposit_id');
  });

  it('models the two-step declare/verify deposit flow', () => {
    const columns = columnNames(schema.cashDeposits);
    // A driver declares...
    expect(columns).toContain('declared_amount_paise');
    expect(columns).toContain('declared_at');
    // ...an admin verifies. Separate columns because they are separate acts by
    // separate people (separation of duties).
    expect(columns).toContain('verified_amount_paise');
    expect(columns).toContain('verified_by');
    expect(columns).toContain('verified_at');
    // Variance is recorded, never reconciled away.
    expect(columns).toContain('variance_paise');

    expect([...schema.cashDepositStatus.enumValues]).toContain('DECLARED');
    expect([...schema.cashDepositStatus.enumValues]).toContain('VERIFIED');
    expect([...schema.cashDepositStatus.enumValues]).toContain('PARTIAL');
  });

  it('records COD collection variance on the delivery', () => {
    const columns = columnNames(schema.deliveries);
    expect(columns).toContain('cod_expected_paise');
    expect(columns).toContain('cod_collected_paise');
    expect(columns).toContain('cod_variance_paise');
  });

  it('keeps orders.cod_amount_paise authoritative and delivery a snapshot', () => {
    // The audit found this duplication; deliveries must NOT have its own
    // cod_amount_paise, or there would be two authoritative amounts.
    expect(columnNames(schema.orders)).toContain('cod_amount_paise');
    expect(columnNames(schema.deliveries)).not.toContain('cod_amount_paise');
  });

  it('requires a COD order to carry an amount, and a prepaid order not to', () => {
    expect(checkNames(schema.orders)).toContain('orders_cod_amount_consistent');
  });
});

// ---------------------------------------------------------------------------
// Order history and snapshots
// ---------------------------------------------------------------------------

describe('order snapshots and history', () => {
  it('freezes the delivery address on the order', () => {
    // An order must stay readable and disputable even if the address is edited
    // or deleted afterwards.
    expect(columnNames(schema.orders)).toContain('delivery_address_snapshot');
  });

  it('snapshots every product detail onto the order line', () => {
    const columns = columnNames(schema.orderItems);
    for (const snapshot of [
      'product_name_snapshot',
      'variant_label_snapshot',
      'image_key_snapshot',
      'unit_label_snapshot',
      'sku_snapshot',
      'hsn_snapshot',
    ]) {
      expect(columns, `order_items must snapshot ${snapshot}`).toContain(snapshot);
    }

    // Prices are snapshotted too: a reprice tomorrow must not alter yesterday's
    // invoice.
    expect(columns).toContain('mrp_paise');
    expect(columns).toContain('unit_price_paise');
    expect(columns).toContain('line_total_paise');
  });

  it('keeps the coupon code as a snapshot, not just a foreign key', () => {
    expect(columnNames(schema.orders)).toContain('coupon_code_snapshot');
  });

  it('records the full money breakup rather than a single total', () => {
    // docs/DATABASE.md §1.1 — an auditable breakup, not one computed number.
    const columns = columnNames(schema.orders);
    for (const field of [
      'gross_amount_paise',
      'item_discount_paise',
      'coupon_discount_paise',
      'taxable_amount_paise',
      'tax_amount_paise',
      'delivery_fee_paise',
      'packaging_fee_paise',
      'service_fee_paise',
      'total_amount_paise',
    ]) {
      expect(columns, `orders must record ${field}`).toContain(field);
    }
  });

  it('logs every status transition with an actor', () => {
    const columns = columnNames(schema.orderStatusHistory);
    expect(columns).toContain('from_status');
    expect(columns).toContain('to_status');
    expect(columns).toContain('changed_by_user_id');
    expect(columns).toContain('changed_by_role');
    expect(columns).toContain('reason');
  });

  it('makes order creation idempotent', () => {
    // Repeated clicks and network retries must not create duplicate orders.
    expect(indexNames(schema.orders)).toContain('orders_idempotency_key');
  });

  it('carries a version column for optimistic locking', () => {
    expect(columnNames(schema.orders)).toContain('version');
  });
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

describe('payment integrity', () => {
  it('protects against webhook replay at the database level', () => {
    // Not merely in code: a duplicate provider event fails the insert.
    expect(indexNames(schema.paymentEvents)).toContain('payment_events_provider_event_key');
  });

  it('retains the raw payload and signature validity for disputes', () => {
    const columns = columnNames(schema.paymentEvents);
    expect(columns).toContain('raw_payload');
    expect(columns).toContain('signature');
    expect(columns).toContain('signature_valid');
  });

  it('makes payment creation idempotent', () => {
    expect(indexNames(schema.payments)).toContain('payments_idempotency_key');
  });

  it('supports reconciliation of payments the webhook never confirmed', () => {
    const columns = columnNames(schema.payments);
    expect(columns).toContain('reconciled_at');
    expect(columns).toContain('reconciliation_note');
  });

  it('allows a refund with no gateway payment, for COD', () => {
    // A COD refund is a manual payout: there is no captured payment to reverse.
    const paymentIdColumn = config(schema.refunds).columns.find(
      (column) => column.name === 'payment_id'
    );
    expect(paymentIdColumn?.notNull, 'refunds.payment_id must be nullable for COD').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

describe('coupon limits', () => {
  it('makes per-order redemption unique so per-user limits are race-safe', () => {
    expect(indexNames(schema.couponUsages)).toContain('coupon_usages_order_key');
  });

  it('indexes usage by coupon and user for the per-user limit check', () => {
    expect(indexNames(schema.couponUsages)).toContain('coupon_usages_user_idx');
  });
});

// ---------------------------------------------------------------------------
// Dispatch (D-18)
// ---------------------------------------------------------------------------

describe('dispatch (D-18)', () => {
  it('makes dispatch quality measurable', () => {
    // Without these, "why was a far driver assigned?" is unanswerable.
    const columns = columnNames(schema.deliveryAssignments);
    expect(columns).toContain('attempt_number');
    expect(columns).toContain('dispatch_mode');
    expect(columns).toContain('distance_at_offer_km');
    expect(columns).toContain('offer_expires_at');
    expect(columns).toContain('response');
  });

  it('prevents duplicate attempt numbers per delivery', () => {
    expect(indexNames(schema.deliveryAssignments)).toContain('delivery_assignments_attempt_key');
  });

  it('records TIMEOUT as a distinct response from DECLINED', () => {
    // A driver ignoring an offer is operationally different from refusing it.
    expect(schema.assignmentResponse.enumValues).toContain('TIMEOUT');
    expect(schema.assignmentResponse.enumValues).toContain('DECLINED');
  });
});

// ---------------------------------------------------------------------------
// Delivery proof (D-20)
// ---------------------------------------------------------------------------

describe('delivery proof (D-20)', () => {
  it('makes the delivery OTP hash mandatory', () => {
    const otpColumn = config(schema.deliveries).columns.find(
      (column) => column.name === 'delivery_otp_hash'
    );
    expect(otpColumn?.notNull, 'delivery OTP is mandatory for every delivery').toBe(true);
  });

  it('stores only a hash of the OTP, never the code', () => {
    const columns = columnNames(schema.deliveries);
    expect(columns).toContain('delivery_otp_hash');
    expect(columns).not.toContain('delivery_otp');
    expect(columns).not.toContain('otp_code');
  });

  it('caps OTP attempts', () => {
    expect(columnNames(schema.deliveries)).toContain('otp_attempts');
  });

  it('supports photo and signature as exception mechanisms', () => {
    for (const type of ['OTP', 'PHOTO', 'SIGNATURE', 'CUSTOMER_CONFIRMATION']) {
      expect(schema.proofType.enumValues).toContain(type);
    }
  });
});

// ---------------------------------------------------------------------------
// Identity (D-08, D-09)
// ---------------------------------------------------------------------------

describe('identity (D-08, D-09)', () => {
  it('has NO password column anywhere', () => {
    // D-09: Firebase phone OTP only. A password column would be an entire
    // threat class reintroduced by accident.
    const offenders: string[] = [];

    for (const [, value] of Object.entries(schema)) {
      if (!value || typeof value !== 'object' || !(Symbol.for('drizzle:Name') in value)) continue;
      try {
        const table = config(value as PgTable);
        for (const column of table.columns) {
          if (/password/i.test(column.name)) offenders.push(`${table.name}.${column.name}`);
        }
      } catch {
        // Not a table.
      }
    }

    expect(offenders, `Password columns found: ${offenders.join(', ')}`).toEqual([]);
  });

  it('requires a unique firebase_uid as the identity join key', () => {
    const column = config(schema.users).columns.find((c) => c.name === 'firebase_uid');
    expect(column?.notNull).toBe(true);
    expect(indexNames(schema.users)).toContain('users_firebase_uid_key');
  });

  it('stores only a hash of the session token', () => {
    const columns = columnNames(schema.sessions);
    expect(columns).toContain('token_hash');
    expect(columns).not.toContain('token');
  });

  it('supports session revocation', () => {
    const columns = columnNames(schema.sessions);
    expect(columns).toContain('revoked_at');
    expect(columns).toContain('revoked_reason');
  });

  it('stores only a hash of any OTP code', () => {
    const columns = columnNames(schema.otpVerifications);
    expect(columns).toContain('code_hash');
    expect(columns).not.toContain('code');
  });

  it('scopes roles so vendor staff is possible', () => {
    const columns = columnNames(schema.userRoles);
    expect(columns).toContain('scope_type');
    expect(columns).toContain('scope_id');
  });
});

// ---------------------------------------------------------------------------
// Localisation (D-33)
// ---------------------------------------------------------------------------

describe('localisation (D-33)', () => {
  const translationTables: Array<[string, PgTable, string]> = [
    ['category_translations', schema.categoryTranslations, 'category_id'],
    ['product_translations', schema.productTranslations, 'product_id'],
    ['product_variant_translations', schema.productVariantTranslations, 'variant_id'],
    ['brand_translations', schema.brandTranslations, 'brand_id'],
    ['cms_page_translations', schema.cmsPageTranslations, 'cms_page_id'],
    ['blog_post_translations', schema.blogPostTranslations, 'blog_post_id'],
    ['banner_translations', schema.bannerTranslations, 'banner_id'],
    ['faq_translations', schema.faqTranslations, 'faq_id'],
    ['coupon_translations', schema.couponTranslations, 'coupon_id'],
    ['seo_meta_translations', schema.seoMetaTranslations, 'seo_meta_id'],
    ['cancellation_reason_translations', schema.cancellationReasonTranslations, 'reason_id'],
  ];

  it('gives every translation table a unique (entity, locale) key', () => {
    for (const [name, table, entityColumn] of translationTables) {
      const unique = uniqueIndexes(table);
      const key = unique.find((index) => {
        const columns = index.config.columns.map((column) => ('name' in column ? column.name : ''));
        return columns.includes(entityColumn) && columns.includes('locale');
      });

      expect(key, `${name} must be unique on (${entityColumn}, locale)`).toBeDefined();
    }
  });

  it('indexes locale on every translation table for completeness reporting', () => {
    for (const [name, table] of translationTables) {
      const hasLocaleIndex = config(table).indexes.some((index) =>
        index.config.columns.some((column) => 'name' in column && column.name === 'locale')
      );
      expect(hasLocaleIndex, `${name} should index locale`).toBe(true);
    }
  });

  it('keeps translated text OUT of base tables', () => {
    /**
     * §10.1 rule 1: a base table never holds one privileged language. If `name`
     * reappeared on `products`, the fallback logic would be bypassed and Hindi
     * users would silently get English.
     */
    expect(columnNames(schema.products)).not.toContain('name');
    expect(columnNames(schema.products)).not.toContain('description');
    expect(columnNames(schema.categories)).not.toContain('name');
    expect(columnNames(schema.brands)).not.toContain('name');
  });

  it('keeps the slug language-neutral on the base table', () => {
    // §10.1 rule 4: one canonical slug per entity in V1.
    expect(columnNames(schema.products)).toContain('slug');
    expect(columnNames(schema.productTranslations)).not.toContain('slug');
  });

  it('keys notification templates on locale directly', () => {
    expect(columnNames(schema.notificationTemplates)).toContain('locale');
  });

  it('places per-locale search vectors with the text they index', () => {
    /**
     * Deliberate deviation from docs/DATABASE.md §5, which places these on
     * `products`: a PostgreSQL generated column may only reference columns in the
     * SAME row, and the text lives here. Placing them on `products` would fail at
     * migration time.
     */
    const columns = columnNames(schema.productTranslations);
    expect(columns).toContain('search_vector_english');
    expect(columns).toContain('search_vector_simple');
    expect(columnNames(schema.products)).not.toContain('search_vector_en');
  });
});

// ---------------------------------------------------------------------------
// Tax stays inert (D-14 blocked)
// ---------------------------------------------------------------------------

describe('tax remains inert (D-14 BLOCKED)', () => {
  it('creates tax columns without any default rate', () => {
    // Columns exist so unblocking D-14 is a backfill, not a migration across
    // live financial tables. They must carry NO assumed rate.
    const productColumns = config(schema.products).columns;
    const taxRate = productColumns.find((column) => column.name === 'tax_rate');

    expect(taxRate, 'products.tax_rate must exist').toBeDefined();
    expect(taxRate?.notNull, 'products.tax_rate must be nullable').toBe(false);
    expect(taxRate?.hasDefault, 'products.tax_rate must have no default rate').toBe(false);

    expect(productColumns.map((c) => c.name)).toContain('hsn_code');
  });

  it('creates tax_rates and invoices tables that are simply not used yet', () => {
    expect(columnNames(schema.taxRates)).toContain('rate');
    expect(columnNames(schema.invoices)).toContain('invoice_number');
  });

  it('defaults order tax amounts to zero rather than guessing', () => {
    const taxAmount = config(schema.orders).columns.find(
      (column) => column.name === 'tax_amount_paise'
    );
    expect(taxAmount?.hasDefault).toBe(true);
    expect(taxAmount?.default).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Single-vendor cart (D-11)
// ---------------------------------------------------------------------------

describe('single-vendor cart (D-11)', () => {
  it('binds a cart to at most one store', () => {
    expect(columnNames(schema.carts)).toContain('store_id');
  });

  it('binds an order to exactly one store and vendor', () => {
    const storeId = config(schema.orders).columns.find((column) => column.name === 'store_id');
    const vendorId = config(schema.orders).columns.find((column) => column.name === 'vendor_id');

    expect(storeId?.notNull).toBe(true);
    expect(vendorId?.notNull).toBe(true);
  });

  it('has no order-group parent table in V1', () => {
    // Multi-vendor split orders are explicitly out of scope.
    expect(Object.keys(schema)).not.toContain('orderGroups');
  });

  it('requires a cart to have an owner, guest or user', () => {
    expect(checkNames(schema.carts)).toContain('carts_owner_present');
  });
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

describe('audit trail', () => {
  it('records actor, action, entity and a before/after diff', () => {
    const columns = columnNames(schema.auditLogs);
    for (const field of [
      'actor_user_id',
      'actor_role',
      'actor_ip_hash',
      'action',
      'entity_type',
      'entity_id',
      'before',
      'after',
      'changed_fields',
      'request_id',
    ]) {
      expect(columns, `audit_logs must record ${field}`).toContain(field);
    }
  });

  it('has no updated_at, because it is append-only', () => {
    expect(columnNames(schema.auditLogs)).not.toContain('updated_at');
  });

  it('includes the audit actions the COD flow requires', () => {
    expect(schema.auditAction.enumValues).toContain('CASH_DEPOSIT_VERIFY');
    expect(schema.auditAction.enumValues).toContain('PII_REVEAL');
  });
});
