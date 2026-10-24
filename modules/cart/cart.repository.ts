import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { cartItems, carts, coupons, productVariants } from '@/db/schema';
import type { Database } from '@/lib/db/client';
import type { RepositoryContext } from '@/lib/db/repository';
import type { CartStore } from './cart.repository.types';
import type { CartIntent } from './cart.types';

/**
 * Drizzle cart store — the only place `carts` and `cart_items` are touched.
 *
 * WHAT IS PERSISTED AND WHAT IS NOT. Only intent: which variant, how many, which store,
 * which coupon code. No totals, ever. `carts` has no total column by design, and
 * `cart_items.unit_price_paise_snapshot` exists to DETECT a price change since
 * add-to-cart — never to charge one (docs/DATABASE.md §6). Every price the customer
 * sees is re-read by the service on each view.
 */
export class DrizzleCartStore implements CartStore {
  private readonly db: Database;

  constructor(context: RepositoryContext) {
    this.db = context.db;
  }

  async load(userId: string): Promise<CartIntent> {
    const [cart] = await this.db
      .select({
        id: carts.id,
        storeId: carts.storeId,
        // Joined rather than stored: the cart holds `applied_coupon_id`, while the
        // service works in codes, and the code is what the customer typed.
        couponCode: coupons.code,
      })
      .from(carts)
      .leftJoin(coupons, eq(coupons.id, carts.appliedCouponId))
      .where(eq(carts.userId, userId))
      .limit(1);

    if (!cart) return { storeId: null, lines: [], couponCode: null };

    const lines = await this.db
      .select({ variantId: cartItems.variantId, quantity: cartItems.quantity })
      .from(cartItems)
      .where(eq(cartItems.cartId, cart.id))
      // Stable order so the cart page does not reshuffle between reads.
      .orderBy(cartItems.addedAt);

    return {
      storeId: cart.storeId,
      lines: lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
      couponCode: cart.couponCode,
    };
  }

  /**
   * Writes the intent in ONE transaction.
   *
   * Not a delete-then-insert: that would (a) briefly expose an empty cart to a
   * concurrent read, and (b) reset every `unit_price_paise_snapshot`, destroying the
   * only signal that a price moved since the customer added the item. Instead lines
   * absent from the intent are deleted, and the rest are upserted with the quantity
   * updated and the snapshot left alone.
   */
  async save(userId: string, intent: CartIntent): Promise<void> {
    await this.db.transaction(async (tx) => {
      // An empty intent means an empty cart. Deleting the row (rather than keeping a
      // shell) keeps `carts` free of rows that represent nothing.
      if (intent.lines.length === 0) {
        await tx.delete(carts).where(eq(carts.userId, userId));
        return;
      }

      const couponId = intent.couponCode
        ? // A code that no longer resolves stores NULL rather than failing the save:
          // the service re-validates on every view and will report the rejection, and
          // a coupon that was withdrawn must not make the cart unwritable.
          sql`(select ${coupons.id} from ${coupons} where ${coupons.code} = ${intent.couponCode} limit 1)`
        : null;

      const [cart] = await tx
        .insert(carts)
        .values({
          userId,
          storeId: intent.storeId,
          appliedCouponId: couponId as unknown as string | null,
          lastPricedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: carts.userId,
          // Partial unique index, so the upsert target needs the same predicate.
          targetWhere: sql`user_id is not null`,
          set: {
            storeId: intent.storeId,
            appliedCouponId: couponId as unknown as string | null,
            lastPricedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning({ id: carts.id });

      if (!cart) return;

      const variantIds = intent.lines.map((line) => line.variantId);

      // Drop lines the customer removed.
      await tx
        .delete(cartItems)
        .where(and(eq(cartItems.cartId, cart.id), notInArray(cartItems.variantId, variantIds)));

      for (const line of intent.lines) {
        /**
         * `product_id` and the price snapshot are taken FROM THE DATABASE, not from the
         * caller. `cart_items` requires both, and accepting either from a request would
         * let a client claim a variant belongs to a different product or was cheaper
         * than it is. An `INSERT … SELECT` makes that impossible rather than merely
         * unlikely.
         *
         * A variant that no longer exists inserts nothing, and the service's next view
         * simply drops the line.
         */
        await tx.execute(sql`
          insert into ${cartItems} (cart_id, product_id, variant_id, quantity, unit_price_paise_snapshot)
          select ${cart.id}, ${productVariants.productId}, ${productVariants.id},
                 ${line.quantity}, ${productVariants.pricePaise}
          from ${productVariants}
          where ${productVariants.id} = ${line.variantId}
          on conflict (cart_id, variant_id) do update
            set quantity = excluded.quantity,
                updated_at = now()
        `);
      }
    });
  }

  async clear(userId: string): Promise<void> {
    // Items cascade from the cart row.
    await this.db.delete(carts).where(eq(carts.userId, userId));
  }

  /**
   * Deletes the carts of users whose carts have expired.
   *
   * Called by the retention cron (docs/DATABASE.md §13). Abandoned carts otherwise
   * accumulate forever, and they hold no value once the prices in them are stale.
   */
  async deleteExpired(before: Date): Promise<number> {
    const deleted = await this.db
      .delete(carts)
      .where(and(sql`${carts.expiresAt} is not null`, sql`${carts.expiresAt} < ${before}`))
      .returning({ id: carts.id });

    return deleted.length;
  }

  /** Test/support helper: which users currently hold a cart for a given store. */
  async countCartsForStore(storeId: string): Promise<number> {
    const rows = await this.db
      .select({ id: carts.id })
      .from(carts)
      .where(inArray(carts.storeId, [storeId]));

    return rows.length;
  }
}

export function createCartStore(context: RepositoryContext): CartStore {
  return new DrizzleCartStore(context);
}
