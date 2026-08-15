import type { LocaleScope } from '@/lib/db/repository';
import type { Coupon, OfferSummary } from './coupon.types';

/**
 * Coupon persistence contract.
 *
 * Two implementations: Drizzle over Postgres, and an in-memory one for a
 * credential-free clone and the public preview. The interface is written so both
 * can satisfy it honestly — nothing here assumes SQL.
 */
export interface CouponRepository {
  /**
   * Loads a coupon and its restrictions by code.
   *
   * Case-insensitive at the boundary: customers type `demofirst50` and paste
   * `DEMOFIRST50`, and refusing one of those would be an invented rule.
   */
  findByCode(code: string): Promise<Coupon | null>;

  /**
   * Redemptions of this coupon by this user.
   *
   * Separate from the coupon row because `used_count` is a total across everyone
   * and the per-user limit needs a per-user count.
   */
  countUserUsages(couponId: string, userId: string): Promise<number>;

  /** Whether the customer has never completed an order, for `first_order_only`. */
  isFirstOrder(userId: string): Promise<boolean>;

  /**
   * Publicly listable coupons for the offers page.
   *
   * User-specific coupons are excluded: listing a targeted code publicly defeats
   * the targeting. Zone-restricted coupons are filtered by `zoneId` when one is
   * known, and included when it is not — a customer who has not chosen a location
   * yet should still see what is on offer.
   */
  listPublicOffers(scope: LocaleScope, zoneId?: string | null): Promise<OfferSummary[]>;
}
