import { DEV_COUPONS } from '@/db/seed/dev-data';
import { defaultLocale, type Locale } from '@/i18n/routing';
import { fixtureId } from '@/lib/db/fixture-id';
import type { LocaleScope } from '@/lib/db/repository';
import type { CouponRepository } from './coupon.repository.types';
import type { Coupon, CouponRestriction, OfferSummary } from './coupon.types';

/**
 * In-memory coupon repository.
 *
 * WHY THIS EXISTS: the application must run and pass its full test suite with no
 * external dependencies (.kiro/steering/provider-credentials.md). A managed
 * Postgres provider is still unchosen (D-01a) and no migrations exist, so without
 * this the coupon flow could not be exercised at all and `/offers` would show
 * nothing.
 *
 * SINGLE SOURCE OF TRUTH: `DEV_COUPONS` — the exact rows `pnpm seed` writes. Local
 * fixtures here would let the fake and the real database drift, and the failure
 * would be silent: a coupon that applies in preview and is refused in production.
 *
 * It replaces the I/O, NOT the rules. Every eligibility decision still goes through
 * `coupon.engine.ts`; this only returns rows. Refused in production by
 * `modules/coupons/index.ts`.
 *
 * IDs are derived with `fixtureId`, the same helper the in-memory catalog uses, so
 * a category restriction here points at the same category id the catalogue serves.
 */

const COUPON_NAMESPACE = 'coupon';
const CATEGORY_NAMESPACE = 'category';

function buildCoupon(fixture: (typeof DEV_COUPONS)[number]): Coupon {
  const restrictions: CouponRestriction[] = (fixture.categorySlugs ?? []).map((slug) => ({
    restrictionType: 'CATEGORY' as const,
    restrictionId: fixtureId(CATEGORY_NAMESPACE, slug),
  }));

  return {
    id: fixtureId(COUPON_NAMESPACE, fixture.code),
    code: fixture.code,
    couponType: fixture.couponType,
    discountValue: fixture.discountValue,
    maxDiscountPaise: fixture.maxDiscountPaise ?? null,
    minCartPaise: fixture.minCartPaise,
    scope: restrictions.length > 0 ? 'CATEGORY' : 'CART',
    firstOrderOnly: fixture.firstOrderOnly,
    isUserSpecific: false,
    // No fixture exercises a usage limit: an in-memory store cannot count
    // redemptions across requests, so a limit here would be decorative. The rules
    // themselves are covered exhaustively by the engine's unit tests.
    usageLimitTotal: null,
    usageLimitPerUser: null,
    usedCount: 0,
    validFrom: null,
    validUntil: null,
    isActive: true,
    isStackable: false,
    restrictions,
  };
}

export class InMemoryCouponRepository implements CouponRepository {
  private readonly byCode = new Map<string, Coupon>(
    DEV_COUPONS.map((fixture) => [fixture.code, buildCoupon(fixture)])
  );

  findByCode(code: string): Promise<Coupon | null> {
    return Promise.resolve(this.byCode.get(code.trim().toUpperCase()) ?? null);
  }

  countUserUsages(): Promise<number> {
    // No order history exists without a database, so nobody has redeemed anything.
    return Promise.resolve(0);
  }

  isFirstOrder(): Promise<boolean> {
    // Same reason. This makes first-order coupons applicable in preview, which is
    // the honest answer: there are no previous orders to find.
    return Promise.resolve(true);
  }

  listPublicOffers(scope: LocaleScope): Promise<OfferSummary[]> {
    const offers = DEV_COUPONS.map((fixture) => {
      const coupon = this.byCode.get(fixture.code)!;
      const locale = scope.locale as Locale;
      // English fallback, matching the SQL `coalesce` (D-33).
      const copy = fixture.translations[locale] ?? fixture.translations[defaultLocale];

      return {
        id: coupon.id,
        code: coupon.code,
        couponType: coupon.couponType,
        discountValue: coupon.discountValue,
        maxDiscountPaise: coupon.maxDiscountPaise,
        minCartPaise: coupon.minCartPaise,
        firstOrderOnly: coupon.firstOrderOnly,
        validUntil: coupon.validUntil,
        name: copy?.name ?? coupon.code,
        description: copy?.description ?? null,
      };
    });

    // Same ordering as the SQL: cheapest to unlock first.
    offers.sort((a, b) => a.minCartPaise - b.minCartPaise || a.code.localeCompare(b.code));

    return Promise.resolve(offers);
  }
}

/** Fixture summary for development diagnostics. */
export function inMemoryCouponSummary(): { codes: string[] } {
  return { codes: DEV_COUPONS.map((fixture) => fixture.code) };
}
