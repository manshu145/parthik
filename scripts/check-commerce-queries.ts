/* eslint-disable no-console */
/**
 * Executes the COMMERCE SQL against a real PostgreSQL database.
 *
 * Companion to scripts/check-catalog-queries.ts, and it exists for the same reason:
 * Drizzle typechecks the query BUILDER, not the statement it emits. Raw `sql` templates,
 * `INSERT … SELECT`, partial-index upsert targets and `ON CONFLICT` clauses all
 * typecheck happily and can still be rejected by Postgres — and the cart store uses
 * every one of those.
 *
 * Run via scripts/db-integration-check.sh, which provisions a throwaway database.
 */
import { and, eq } from 'drizzle-orm';
import { products, productVariants } from '@/db/schema/catalog';
import { inventory, inventoryTransactions } from '@/db/schema/inventory';
import { payments } from '@/db/schema/payments';
import { stores } from '@/db/schema/marketplace';
import { coupons } from '@/db/schema/marketing';
import { closeDb, getDb } from '@/lib/db/client';
import { DrizzleCartStore } from '@/modules/cart/cart.repository';
import { DrizzleCustomerRepository } from '@/modules/customer/customer.repository';
import { DrizzleOrderRepository } from '@/modules/order/order.repository';
import { DrizzleIdentityRepository } from '@/modules/identity/identity.repository';
import { DrizzleSettingsRepository } from '@/modules/settings/settings.repository';

let failures = 0;

async function check(label: string, run: () => Promise<unknown>): Promise<unknown> {
  try {
    const result = await run();
    console.log(`  ✅ ${label}`);
    return result;
  } catch (error) {
    failures += 1;
    console.error(`  ❌ ${label}`);
    console.error(`     ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function main(): Promise<void> {
  const db = await getDb();
  const carts = new DrizzleCartStore({ db });
  const identity = new DrizzleIdentityRepository({ db });
  const addresses = new DrizzleCustomerRepository({ db });
  const orderRepo = new DrizzleOrderRepository({ db });

  console.log('\nCommerce queries against real PostgreSQL:\n');

  // A real seeded user and two real seeded variants.
  const user = await identity.findUserByFirebaseUid('dev-firebase-uid-customer');
  if (!user) {
    console.error('❌ dev-firebase-uid-customer is not seeded. Run `pnpm seed:demo` first.');
    process.exitCode = 1;
    return;
  }

  // Queried directly rather than through the catalog service: this script is about the
  // commerce SQL, and a direct read keeps the fixture setup obvious.
  const seededVariants = await db
    .select({ variantId: productVariants.id, storeId: products.storeId, productId: products.id })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .limit(2);

  if (seededVariants.length < 2) {
    console.error(`❌ Need at least 2 seeded variants, found ${seededVariants.length}.`);
    process.exitCode = 1;
    return;
  }

  const variantA = seededVariants[0]!.variantId;
  const variantB = seededVariants[1]!.variantId;
  const storeId = seededVariants[0]!.storeId;

  // ---- Cart store ----
  await check('cart.load (no cart yet)', async () => {
    const intent = await carts.load(user.id);
    if (intent.lines.length !== 0) throw new Error('expected an empty intent');
    return intent;
  });

  await check('cart.save (insert … select resolves product_id and price snapshot)', () =>
    carts.save(user.id, {
      storeId,
      lines: [{ variantId: variantA, quantity: 2 }],
      couponCode: null,
    })
  );

  await check('cart.load (round-trips the saved intent)', async () => {
    const intent = await carts.load(user.id);
    if (intent.lines.length !== 1) throw new Error(`expected 1 line, got ${intent.lines.length}`);
    if (intent.lines[0]?.quantity !== 2) throw new Error('quantity did not round-trip');
    if (intent.storeId !== storeId) throw new Error('storeId did not round-trip');
    return intent;
  });

  await check('cart.save (upsert on the partial unique index, second call)', () =>
    carts.save(user.id, {
      storeId,
      lines: [
        { variantId: variantA, quantity: 5 },
        { variantId: variantB, quantity: 1 },
      ],
      couponCode: null,
    })
  );

  await check('cart.load (quantity updated, line added)', async () => {
    const intent = await carts.load(user.id);
    if (intent.lines.length !== 2) throw new Error(`expected 2 lines, got ${intent.lines.length}`);
    const a = intent.lines.find((line) => line.variantId === variantA);
    if (a?.quantity !== 5) throw new Error(`expected quantity 5, got ${a?.quantity}`);
    return intent;
  });

  await check('cart.save (removes lines absent from the intent)', async () => {
    await carts.save(user.id, {
      storeId,
      lines: [{ variantId: variantB, quantity: 3 }],
      couponCode: null,
    });
    const intent = await carts.load(user.id);
    if (intent.lines.length !== 1) throw new Error(`expected 1 line, got ${intent.lines.length}`);
    if (intent.lines[0]?.variantId !== variantB) throw new Error('wrong line survived');
    return intent;
  });

  await check('cart.save (unknown coupon code stores NULL rather than failing)', async () => {
    await carts.save(user.id, {
      storeId,
      lines: [{ variantId: variantB, quantity: 1 }],
      couponCode: 'DEFINITELY-NOT-A-REAL-COUPON',
    });
    const intent = await carts.load(user.id);
    if (intent.couponCode !== null) throw new Error('expected the coupon to resolve to null');
    return intent;
  });

  await check('cart.save (a real seeded coupon round-trips)', async () => {
    // Any coupon will do; the point is the code -> id -> code round trip through
    // `carts.applied_coupon_id`.
    const [row] = await db.select({ code: coupons.code }).from(coupons).limit(1);
    const code = row?.code;

    if (!code) {
      console.log('     (no coupons seeded, skipping)');
      return null;
    }

    await carts.save(user.id, {
      storeId,
      lines: [{ variantId: variantB, quantity: 1 }],
      couponCode: code,
    });
    const intent = await carts.load(user.id);
    if (intent.couponCode !== code) {
      throw new Error(`coupon did not round-trip: stored ${code}, read ${intent.couponCode}`);
    }
    return intent;
  });

  await check('cart.save (an unknown variant inserts nothing rather than erroring)', async () => {
    await carts.save(user.id, {
      storeId,
      lines: [
        { variantId: variantB, quantity: 1 },
        // Well-formed uuid that matches no variant.
        { variantId: '00000000-0000-7000-8000-000000000000', quantity: 1 },
      ],
      couponCode: null,
    });
    const intent = await carts.load(user.id);
    if (intent.lines.length !== 1) {
      throw new Error(
        `expected the unknown variant to be skipped, got ${intent.lines.length} lines`
      );
    }
    return intent;
  });

  await check('cart.save (empty intent deletes the cart row)', async () => {
    await carts.save(user.id, { storeId: null, lines: [], couponCode: null });
    const intent = await carts.load(user.id);
    if (intent.lines.length !== 0 || intent.storeId !== null) {
      throw new Error('expected the cart to be gone');
    }
    return intent;
  });

  await check('cart.clear (idempotent when no cart exists)', () => carts.clear(user.id));

  // ---- Address book ----
  //
  // The default-address rules are enforced by a PARTIAL unique index
  // (`addresses_default_key ... where is_default = true and deleted_at is null`), so they
  // can only be validated against a real database — an in-memory repository cannot fail
  // the way Postgres would.
  const ADDRESS = {
    addressType: 'HOME' as const,
    recipientName: 'Commerce Check',
    recipientPhone: '+919876543210',
    line1: '1 Test Street',
    city: 'Indore',
    state: 'Madhya Pradesh',
    pincode: '452001',
  };

  let firstAddressId = '';
  let secondAddressId = '';

  await check('address.create (first becomes the default)', async () => {
    const created = await addresses.create(user.id, ADDRESS, null);
    firstAddressId = created.id;
    if (!created.isDefault) throw new Error('the first address must be the default');
    return created;
  });

  await check('address.create (second does not steal the default)', async () => {
    const created = await addresses.create(user.id, { ...ADDRESS, label: 'Second' }, null);
    secondAddressId = created.id;
    if (created.isDefault) throw new Error('a later address must not become the default');
    return created;
  });

  await check('address.setDefault (promotes and demotes in one transaction)', async () => {
    await addresses.setDefault(user.id, secondAddressId);
    const list = await addresses.listForUser(user.id);
    const defaults = list.filter((a) => a.isDefault);
    if (defaults.length !== 1)
      throw new Error(`expected exactly 1 default, got ${defaults.length}`);
    if (defaults[0]?.id !== secondAddressId) throw new Error('the wrong address is default');
    return list;
  });

  await check('address.listForUser (default sorts first)', async () => {
    const list = await addresses.listForUser(user.id);
    if (list[0]?.id !== secondAddressId) throw new Error('the default must sort first');
    return list;
  });

  await check('address.findForUser (scoped to the owner)', async () => {
    const mine = await addresses.findForUser(user.id, firstAddressId);
    if (!mine) throw new Error('the owner could not read their own address');

    // Another user must get null, not a row — and not an error that reveals existence.
    const admin = await identity.findUserByFirebaseUid('dev-firebase-uid-admin');
    if (admin) {
      const theirs = await addresses.findForUser(admin.id, firstAddressId);
      if (theirs !== null) throw new Error('another customer could read this address');
    }
    return mine;
  });

  await check('address.softDelete (promotes a replacement default)', async () => {
    await addresses.softDelete(user.id, secondAddressId);
    const list = await addresses.listForUser(user.id);
    if (list.length !== 1) throw new Error(`expected 1 remaining, got ${list.length}`);
    if (!list[0]?.isDefault) throw new Error('the survivor must become the default');
    return list;
  });

  await check('address.softDelete (deleted rows stay out of reads)', async () => {
    const gone = await addresses.findForUser(user.id, secondAddressId);
    if (gone !== null) throw new Error('a soft-deleted address is still readable');
    return gone;
  });

  await check('address.update (round-trips and keeps the default)', async () => {
    const updated = await addresses.update(
      user.id,
      firstAddressId,
      { ...ADDRESS, line1: '2 Changed Street', landmark: 'Near the park' },
      null
    );
    if (updated?.line1 !== '2 Changed Street') throw new Error('line1 did not round-trip');
    if (!updated?.isDefault) throw new Error('updating must not clear the default');
    return updated;
  });

  await check('address.update (rejects another owner)', async () => {
    const admin = await identity.findUserByFirebaseUid('dev-firebase-uid-admin');
    if (!admin) return null;
    const result = await addresses.update(admin.id, firstAddressId, ADDRESS, null);
    if (result !== null) throw new Error('another customer could update this address');
    return result;
  });

  await check('address.softDelete (rejects another owner)', async () => {
    const admin = await identity.findUserByFirebaseUid('dev-firebase-uid-admin');
    if (!admin) return null;
    const result = await addresses.softDelete(admin.id, firstAddressId);
    if (result !== false) throw new Error('another customer could delete this address');
    return result;
  });

  // ---- Settings ----
  await check('settings.readMany (COD controls resolve from admin_settings)', async () => {
    const rows = await new DrizzleSettingsRepository({ db }).readMany([
      'cod.enabled',
      'cod.max_order_value_paise',
    ]);
    if (rows.length === 0) throw new Error('COD settings are not seeded');
    return rows;
  });

  // ---- Orders ----
  //
  // The highest-risk SQL in the project: one transaction that inserts an order, its lines,
  // a history row, a payment row and a coupon redemption, while reserving stock under
  // `SELECT … FOR UPDATE`. Almost none of that can be validated without a real database —
  // row locks, the check constraints and `nextval` simply do not exist in a fixture.
  const store = await db
    .select({ id: stores.id, vendorId: stores.vendorId })
    .from(stores)
    .limit(1)
    .then((rows) => rows[0]);

  if (!store) {
    console.error('❌ No seeded store. Run `pnpm seed:demo` first.');
    process.exitCode = 1;
    return;
  }

  const orderLine = {
    productId: seededVariants[0]!.productId,
    variantId: variantA,
    productNameSnapshot: 'Commerce Check Product',
    variantLabelSnapshot: null,
    imageKeySnapshot: null,
    unitLabelSnapshot: '1 kg',
    skuSnapshot: null,
    quantity: 2,
    mrpPaise: 20000,
    unitPricePaise: 18000,
    itemDiscountPaise: 4000,
    lineTotalPaise: 36000,
  };

  const baseOrder = {
    userId: user.id,
    storeId: store.id,
    vendorId: store.vendorId,
    deliveryZoneId: null,
    deliveryAddressSnapshot: { line1: '1 Test Street', pincode: '452001', city: 'Indore' },
    contactName: 'Commerce Check',
    contactPhone: '+919876543210',
    lines: [orderLine],
    grossAmountPaise: 40000,
    itemDiscountPaise: 4000,
    couponId: null,
    couponCodeSnapshot: null,
    couponDiscountPaise: 0,
    deliveryFeePaise: 2500,
    packagingFeePaise: 0,
    serviceFeePaise: 0,
    totalAmountPaise: 38500,
    estimatedDeliveryAt: null,
    customerNote: null,
    source: 'WEB' as const,
  };

  // Stock before, so the reservation can be measured rather than assumed.
  const stockBefore = await db
    .select({ available: inventory.quantityAvailable, reserved: inventory.quantityReserved })
    .from(inventory)
    .where(eq(inventory.variantId, variantA))
    .then((rows) => rows[0]);

  let codOrderId = '';

  await check('order.create (COD enters CONFIRMED with a cash amount)', async () => {
    const result = await orderRepo.create({
      ...baseOrder,
      paymentMethod: 'COD',
      idempotencyKey: `check-cod-${Date.now()}`,
    });

    if (!result.ok) throw new Error(`reservation failed: ${JSON.stringify(result.shortfalls)}`);
    codOrderId = result.order.id;

    // D-12: no upstream payment to wait for, so it is CONFIRMED immediately.
    if (result.order.status !== 'CONFIRMED') throw new Error(`status was ${result.order.status}`);
    if (!result.order.isCod) throw new Error('isCod was false');
    if (result.order.codAmountPaise !== 38500)
      throw new Error(`cod amount ${result.order.codAmountPaise}`);
    return result.order;
  });

  await check('order.create (order_number comes from the sequence, not a count)', async () => {
    const detail = await orderRepo.findById(codOrderId);
    if (!/^PK-\d{4}-\d{6}$/.test(detail?.order.orderNumber ?? '')) {
      throw new Error(`unexpected order number: ${detail?.order.orderNumber}`);
    }
    return detail?.order.orderNumber;
  });

  await check('order.create (writes the first history row with a null from_status)', async () => {
    const detail = await orderRepo.findById(codOrderId);
    if (detail?.timeline.length !== 1)
      throw new Error(`timeline had ${detail?.timeline.length} rows`);
    if (detail.timeline[0]?.fromStatus !== null) throw new Error('from_status was not null');
    if (detail.timeline[0]?.toStatus !== 'CONFIRMED') throw new Error('to_status was wrong');
    return detail.timeline;
  });

  await check('order.create (RESERVES stock: available down, reserved up)', async () => {
    const after = await db
      .select({ available: inventory.quantityAvailable, reserved: inventory.quantityReserved })
      .from(inventory)
      .where(eq(inventory.variantId, variantA))
      .then((rows) => rows[0]);

    if (!stockBefore || !after) throw new Error('no inventory row');
    if (after.available !== stockBefore.available - 2) {
      throw new Error(`available ${stockBefore.available} -> ${after.available}, expected -2`);
    }
    if (after.reserved !== stockBefore.reserved + 2) {
      throw new Error(`reserved ${stockBefore.reserved} -> ${after.reserved}, expected +2`);
    }
    return after;
  });

  await check('order.create (writes a RESERVE ledger row linked to the order)', async () => {
    const rows = await db
      .select({
        txnType: inventoryTransactions.txnType,
        delta: inventoryTransactions.quantityDelta,
      })
      .from(inventoryTransactions)
      .where(
        and(
          eq(inventoryTransactions.referenceId, codOrderId),
          eq(inventoryTransactions.txnType, 'RESERVE')
        )
      );

    if (rows.length !== 1) throw new Error(`expected 1 RESERVE row, got ${rows.length}`);
    if (rows[0]?.delta !== -2) throw new Error(`delta was ${rows[0]?.delta}`);
    return rows;
  });

  await check('order.create (creates a payments row for COD too)', async () => {
    const rows = await db
      .select({ method: payments.method, status: payments.status, provider: payments.provider })
      .from(payments)
      .where(eq(payments.orderId, codOrderId));

    // Cash is still a payment; without a row COD orders are invisible to every payment report.
    if (rows.length !== 1) throw new Error(`expected 1 payment, got ${rows.length}`);
    if (rows[0]?.status !== 'PENDING') throw new Error(`status was ${rows[0]?.status}`);
    if (rows[0]?.provider !== 'cod') throw new Error(`provider was ${rows[0]?.provider}`);
    return rows;
  });

  await check('order.create (writes fully snapshotted lines)', async () => {
    const detail = await orderRepo.findById(codOrderId);
    const line = detail?.lines[0];
    if (line?.productNameSnapshot !== 'Commerce Check Product')
      throw new Error('name not snapshotted');
    if (line.lineTotalPaise !== 36000) throw new Error(`line total ${line.lineTotalPaise}`);
    return line;
  });

  await check('order.create (tax columns are ZERO — D-14 blocked)', async () => {
    const detail = await orderRepo.findById(codOrderId);
    if (detail?.order.taxAmountPaise !== 0) throw new Error('tax_amount was not 0');
    if (detail.order.taxableAmountPaise !== 0) throw new Error('taxable_amount was not 0');
    return detail.order;
  });

  await check('order.create (prepaid enters PENDING_PAYMENT with no cash amount)', async () => {
    const result = await orderRepo.create({
      ...baseOrder,
      paymentMethod: 'UPI',
      idempotencyKey: `check-upi-${Date.now()}`,
    });

    if (!result.ok) throw new Error('reservation failed');
    if (result.order.status !== 'PENDING_PAYMENT') throw new Error(`status ${result.order.status}`);
    // The check constraint `orders_cod_amount_consistent` enforces this pairing.
    if (result.order.codAmountPaise !== null) throw new Error('prepaid carried a cod amount');
    return result.order;
  });

  await check('order.create (a duplicate idempotency key is rejected by the index)', async () => {
    const key = `check-dupe-${Date.now()}`;
    await orderRepo.create({ ...baseOrder, paymentMethod: 'COD', idempotencyKey: key });

    try {
      await orderRepo.create({ ...baseOrder, paymentMethod: 'COD', idempotencyKey: key });
    } catch {
      // The unique index is the real guarantee; the service checks first, but the database is
      // what makes a concurrent double-submit impossible rather than unlikely.
      return 'rejected';
    }
    throw new Error('a duplicate idempotency key was accepted');
  });

  await check('order.create (reports a shortfall rather than overselling)', async () => {
    const available = await db
      .select({ available: inventory.quantityAvailable })
      .from(inventory)
      .where(eq(inventory.variantId, variantA))
      .then((rows) => rows[0]?.available ?? 0);

    const result = await orderRepo.create({
      ...baseOrder,
      lines: [{ ...orderLine, quantity: available + 50 }],
      paymentMethod: 'COD',
      idempotencyKey: `check-oversell-${Date.now()}`,
    });

    if (result.ok) throw new Error('an oversell was accepted');
    if (result.shortfalls[0]?.available !== available) {
      throw new Error(
        `reported available ${result.shortfalls[0]?.available}, expected ${available}`
      );
    }
    return result.shortfalls;
  });

  await check('order.applyTransition (CONFIRMED -> ACCEPTED stamps and records)', async () => {
    const updated = await orderRepo.applyTransition({
      orderId: codOrderId,
      from: 'CONFIRMED',
      to: 'ACCEPTED',
      actor: 'VENDOR',
      actorUserId: null,
      reason: null,
      effects: ['NOTIFY_CUSTOMER'],
    });

    if (updated.status !== 'ACCEPTED') throw new Error(`status ${updated.status}`);
    if (!updated.acceptedAt) throw new Error('accepted_at was not stamped');

    const detail = await orderRepo.findById(codOrderId);
    if (detail?.timeline.length !== 2) throw new Error(`timeline ${detail?.timeline.length}`);
    return updated;
  });

  await check('order.applyTransition (refuses a stale from-status)', async () => {
    // The order is now ACCEPTED. A second vendor clicking "accept" must lose, not overwrite.
    try {
      await orderRepo.applyTransition({
        orderId: codOrderId,
        from: 'CONFIRMED',
        to: 'ACCEPTED',
        actor: 'VENDOR',
        actorUserId: null,
        reason: null,
        effects: [],
      });
    } catch {
      return 'rejected';
    }
    throw new Error('a stale transition was accepted');
  });

  await check(
    'order.applyTransition (CONSUME_STOCK frees reserved, leaves available)',
    async () => {
      const before = await db
        .select({ available: inventory.quantityAvailable, reserved: inventory.quantityReserved })
        .from(inventory)
        .where(eq(inventory.variantId, variantA))
        .then((rows) => rows[0]);

      // Walk the order to delivery through legal transitions.
      for (const [from, to] of [
        ['ACCEPTED', 'PREPARING'],
        ['PREPARING', 'READY_FOR_PICKUP'],
        ['READY_FOR_PICKUP', 'ASSIGNED'],
        ['ASSIGNED', 'PICKED_UP'],
        ['PICKED_UP', 'OUT_FOR_DELIVERY'],
      ] as const) {
        await orderRepo.applyTransition({
          orderId: codOrderId,
          from,
          to,
          actor: 'ADMIN',
          actorUserId: null,
          reason: null,
          effects: [],
        });
      }

      await orderRepo.applyTransition({
        orderId: codOrderId,
        from: 'OUT_FOR_DELIVERY',
        to: 'DELIVERED',
        actor: 'DRIVER',
        actorUserId: null,
        reason: null,
        effects: ['CONSUME_STOCK', 'COLLECT_COD'],
      });

      const after = await db
        .select({ available: inventory.quantityAvailable, reserved: inventory.quantityReserved })
        .from(inventory)
        .where(eq(inventory.variantId, variantA))
        .then((rows) => rows[0]);

      // available is UNCHANGED — it fell at reservation. Only reserved drops. Decrementing
      // available again here is the obvious mistake and would double-count every sale.
      if (after?.available !== before?.available) {
        throw new Error(`available changed on sale: ${before?.available} -> ${after?.available}`);
      }
      if (after?.reserved !== (before?.reserved ?? 0) - 2) {
        throw new Error(`reserved ${before?.reserved} -> ${after?.reserved}, expected -2`);
      }
      return after;
    }
  );

  await check('order.applyTransition (COLLECT_COD marks the payment PAID)', async () => {
    const [payment] = await db
      .select({ status: payments.status, paidAt: payments.paidAt })
      .from(payments)
      .where(eq(payments.orderId, codOrderId));

    if (payment?.status !== 'PAID') throw new Error(`payment status ${payment?.status}`);
    if (!payment.paidAt) throw new Error('paid_at was not stamped');

    const detail = await orderRepo.findById(codOrderId);
    if (detail?.order.paymentStatus !== 'PAID') throw new Error('order payment_status not PAID');
    return payment;
  });

  await check('order.applyTransition (CONSUME_STOCK is idempotent)', async () => {
    const before = await db
      .select({ reserved: inventory.quantityReserved })
      .from(inventory)
      .where(eq(inventory.variantId, variantA))
      .then((rows) => rows[0]?.reserved ?? 0);

    // A retried queue message must not consume the same reservation twice.
    await orderRepo
      .applyTransition({
        orderId: codOrderId,
        from: 'DELIVERED',
        to: 'DELIVERED',
        actor: 'ADMIN',
        actorUserId: null,
        reason: null,
        effects: ['CONSUME_STOCK'],
      })
      .catch(() => undefined);

    const after = await db
      .select({ reserved: inventory.quantityReserved })
      .from(inventory)
      .where(eq(inventory.variantId, variantA))
      .then((rows) => rows[0]?.reserved ?? 0);

    if (after !== before) throw new Error(`reserved moved on replay: ${before} -> ${after}`);
    return after;
  });

  await check('order.create + RELEASE_STOCK (cancellation returns stock)', async () => {
    const created = await orderRepo.create({
      ...baseOrder,
      paymentMethod: 'COD',
      idempotencyKey: `check-cancel-${Date.now()}`,
    });
    if (!created.ok) throw new Error('reservation failed');

    const before = await db
      .select({ available: inventory.quantityAvailable, reserved: inventory.quantityReserved })
      .from(inventory)
      .where(eq(inventory.variantId, variantA))
      .then((rows) => rows[0]);

    await orderRepo.applyTransition({
      orderId: created.order.id,
      from: 'CONFIRMED',
      to: 'CANCELLED',
      actor: 'CUSTOMER',
      actorUserId: user.id,
      reason: 'Changed my mind',
      effects: ['RELEASE_STOCK', 'RELEASE_COUPON'],
    });

    const after = await db
      .select({ available: inventory.quantityAvailable, reserved: inventory.quantityReserved })
      .from(inventory)
      .where(eq(inventory.variantId, variantA))
      .then((rows) => rows[0]);

    if (after?.available !== (before?.available ?? 0) + 2) {
      throw new Error(`available ${before?.available} -> ${after?.available}, expected +2`);
    }
    if (after?.reserved !== (before?.reserved ?? 0) - 2) {
      throw new Error(`reserved ${before?.reserved} -> ${after?.reserved}, expected -2`);
    }

    const detail = await orderRepo.findById(created.order.id);
    if (detail?.order.cancellationReason !== 'Changed my mind')
      throw new Error('reason not stored');
    if (detail.order.cancelledByRole !== 'CUSTOMER')
      throw new Error('cancelled_by_role not stored');
    return after;
  });

  await check('order.findForUser (scoped to the owner)', async () => {
    const mine = await orderRepo.findForUser(user.id, codOrderId);
    if (!mine) throw new Error('the owner could not read their own order');

    const admin = await identity.findUserByFirebaseUid('dev-firebase-uid-admin');
    if (admin) {
      const theirs = await orderRepo.findForUser(admin.id, codOrderId);
      if (theirs !== null) throw new Error('another customer could read this order');
    }
    return mine.order.orderNumber;
  });

  await check('order.listForUser (keyset pagination)', async () => {
    const first = await orderRepo.listForUser(user.id, { limit: 2 });
    if (first.items.length !== 2) throw new Error(`expected 2 items, got ${first.items.length}`);
    if (!first.nextCursor) throw new Error('expected a next cursor');

    const second = await orderRepo.listForUser(user.id, { limit: 2, cursor: first.nextCursor });
    const overlap = first.items.filter((a) => second.items.some((b) => b.id === a.id));
    if (overlap.length > 0) throw new Error('pages overlapped');

    // The line summary is the part a typechecker cannot defend: a subquery whose join
    // predicate silently resolves against the wrong table returns 0 for every order.
    if (first.items[0]?.itemCount !== 2) {
      throw new Error(`itemCount ${first.items[0]?.itemCount}, expected 2`);
    }
    if (!first.items[0]?.firstItemName) throw new Error('firstItemName was empty');
    return { first: first.items.length, second: second.items.length };
  });

  await check('order.listExpiredPendingPayment (finds unpaid orders past a cutoff)', async () => {
    const future = new Date(Date.now() + 60_000);
    const expired = await orderRepo.listExpiredPendingPayment(future, 10);
    if (!expired.some((order) => order.status === 'PENDING_PAYMENT')) {
      throw new Error('the prepaid order was not found by the sweep query');
    }
    return expired.length;
  });

  console.log(`\n${failures === 0 ? '✅' : '❌'} Commerce SQL: ${failures} failure(s).\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (error: unknown) => {
    console.error(
      '\n❌ Commerce query check failed:',
      error instanceof Error ? error.message : error
    );
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
