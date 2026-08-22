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
import { DrizzleIdentityRepository } from '@/modules/identity/identity.repository';

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
