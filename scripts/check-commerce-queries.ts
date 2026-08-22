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
import { eq } from 'drizzle-orm';
import { products, productVariants } from '@/db/schema/catalog';
import { coupons } from '@/db/schema/marketing';
import { closeDb, getDb } from '@/lib/db/client';
import { DrizzleCartStore } from '@/modules/cart/cart.repository';
import { DrizzleCustomerRepository } from '@/modules/customer/customer.repository';
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
    .select({ variantId: productVariants.id, storeId: products.storeId })
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
