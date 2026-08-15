import { and, count, eq, gt, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { couponRestrictions, couponTranslations, couponUsages, coupons, orders } from '@/db/schema';
import { defaultLocale } from '@/i18n/routing';
import type { LocaleScope, RepositoryContext } from '@/lib/db/repository';
import type { CouponRepository } from './coupon.repository.types';
import type {
  Coupon,
  CouponRestriction,
  CouponRestrictionType,
  CouponScope,
  CouponType,
  OfferSummary,
} from './coupon.types';

/**
 * Coupon repository (Drizzle).
 *
 * The only file in this module permitted to import `@/db/schema` — enforced by the
 * ESLint import-boundary rules.
 *
 * It reads rows and nothing more. Every eligibility decision belongs to
 * `coupon.engine.ts`, so a rule cannot end up half in SQL and half in TypeScript
 * where the two could disagree. The one exception is `listPublicOffers`, which
 * filters on VISIBILITY rather than eligibility — a targeted coupon must not be
 * listed publicly at all, and that is cheaper and safer to express in the query
 * than to fetch-then-discard.
 */

/**
 * Statuses that do NOT count as a completed order for `first_order_only`.
 *
 * A cancelled or failed-payment order must not consume a first-order coupon: the
 * customer never received anything. Anything that reached CONFIRMED or beyond does
 * count, including a refunded order — that order happened.
 */
const NON_ORDERS = ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'CANCELLED'] as const;

export class DrizzleCouponRepository implements CouponRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async findByCode(code: string): Promise<Coupon | null> {
    const rows = await this.ctx.db
      .select({
        id: coupons.id,
        code: coupons.code,
        couponType: coupons.couponType,
        discountValue: coupons.discountValue,
        maxDiscountPaise: coupons.maxDiscountPaise,
        minCartPaise: coupons.minCartPaise,
        scope: coupons.scope,
        firstOrderOnly: coupons.firstOrderOnly,
        isUserSpecific: coupons.isUserSpecific,
        usageLimitTotal: coupons.usageLimitTotal,
        usageLimitPerUser: coupons.usageLimitPerUser,
        usedCount: coupons.usedCount,
        validFrom: coupons.validFrom,
        validUntil: coupons.validUntil,
        isActive: coupons.isActive,
        isStackable: coupons.isStackable,
      })
      .from(coupons)
      // Comparison is on the stored uppercase code; the service normalises input.
      .where(and(eq(coupons.code, code), isNull(coupons.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const restrictionRows = await this.ctx.db
      .select({
        restrictionType: couponRestrictions.restrictionType,
        restrictionId: couponRestrictions.restrictionId,
      })
      .from(couponRestrictions)
      .where(eq(couponRestrictions.couponId, row.id));

    const restrictions: CouponRestriction[] = restrictionRows.map((restriction) => ({
      restrictionType: restriction.restrictionType as CouponRestrictionType,
      restrictionId: restriction.restrictionId,
    }));

    return {
      ...row,
      couponType: row.couponType as CouponType,
      scope: row.scope as CouponScope,
      restrictions,
    };
  }

  async countUserUsages(couponId: string, userId: string): Promise<number> {
    const rows = await this.ctx.db
      .select({ total: count() })
      .from(couponUsages)
      .where(and(eq(couponUsages.couponId, couponId), eq(couponUsages.userId, userId)));

    return Number(rows[0]?.total ?? 0);
  }

  async isFirstOrder(userId: string): Promise<boolean> {
    // EXISTS semantics via limit 1: counting every historical order to answer a
    // yes/no question gets slower for exactly the customers who order most.
    const rows = await this.ctx.db
      .select({ id: orders.id })
      .from(orders)
      // `orders` is deliberately not soft-deleted — an order is a financial record —
      // so there is no deleted_at to exclude here.
      .where(and(eq(orders.userId, userId), notInArray(orders.status, [...NON_ORDERS])))
      .limit(1);

    return rows.length === 0;
  }

  async listPublicOffers(scope: LocaleScope, zoneId?: string | null): Promise<OfferSummary[]> {
    const now = sql`now()`;
    // Two aliased joins onto the same table: the requested locale, then English.
    const requested = alias(couponTranslations, 'ct_req');
    const fallback = alias(couponTranslations, 'ct_fb');

    const rows = await this.ctx.db
      .select({
        id: coupons.id,
        code: coupons.code,
        couponType: coupons.couponType,
        discountValue: coupons.discountValue,
        maxDiscountPaise: coupons.maxDiscountPaise,
        minCartPaise: coupons.minCartPaise,
        firstOrderOnly: coupons.firstOrderOnly,
        validUntil: coupons.validUntil,
        name: sql<string | null>`coalesce(${requested.name}, ${fallback.name})`,
        description: sql<
          string | null
        >`coalesce(${requested.description}, ${fallback.description})`,
      })
      .from(coupons)
      .leftJoin(
        requested,
        and(eq(requested.couponId, coupons.id), eq(requested.locale, scope.locale))
      )
      // English fallback, so a coupon missing Hindi copy still appears (D-33).
      .leftJoin(
        fallback,
        and(eq(fallback.couponId, coupons.id), eq(fallback.locale, defaultLocale))
      )
      .where(
        and(
          eq(coupons.isActive, true),
          isNull(coupons.deletedAt),
          // Targeted coupons are never listed: publishing the code defeats the
          // targeting.
          eq(coupons.isUserSpecific, false),
          or(isNull(coupons.validFrom), sql`${coupons.validFrom} <= ${now}`),
          or(isNull(coupons.validUntil), sql`${coupons.validUntil} >= ${now}`),
          // Exhausted coupons are hidden rather than shown and then refused.
          or(isNull(coupons.usageLimitTotal), gt(coupons.usageLimitTotal, coupons.usedCount)),
          this.zoneVisibility(zoneId)
        )
      )
      .orderBy(coupons.minCartPaise, coupons.code);

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      couponType: row.couponType as CouponType,
      discountValue: row.discountValue,
      maxDiscountPaise: row.maxDiscountPaise,
      minCartPaise: row.minCartPaise,
      firstOrderOnly: row.firstOrderOnly,
      validUntil: row.validUntil,
      // Falls back to the code itself rather than rendering an empty card when a
      // coupon has no translation row at all.
      name: row.name ?? row.code,
      description: row.description,
    }));
  }

  /**
   * Zone visibility.
   *
   * A coupon with no ZONE restriction is available everywhere. One with ZONE
   * restrictions is listed only where it can actually be used — but when the
   * customer has not chosen a location, restricting nothing is the honest default,
   * because the alternative is an offers page that looks empty until they do.
   */
  private zoneVisibility(zoneId?: string | null) {
    const zoneRestricted = this.ctx.db
      .select({ couponId: couponRestrictions.couponId })
      .from(couponRestrictions)
      .where(eq(couponRestrictions.restrictionType, 'ZONE'));

    if (!zoneId) return sql`true`;

    const forThisZone = this.ctx.db
      .select({ couponId: couponRestrictions.couponId })
      .from(couponRestrictions)
      .where(
        and(
          eq(couponRestrictions.restrictionType, 'ZONE'),
          eq(couponRestrictions.restrictionId, zoneId)
        )
      );

    return or(notInArray(coupons.id, zoneRestricted), inArray(coupons.id, forThisZone));
  }
}

export function createCouponRepository(ctx: RepositoryContext): CouponRepository {
  return new DrizzleCouponRepository(ctx);
}
