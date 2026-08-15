import { getServerEnv } from '@/lib/config/env';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { InMemoryCouponRepository, inMemoryCouponSummary } from './coupon-memory.repository';
import { createCouponRepository } from './coupon.repository';
import type { CouponRepository } from './coupon.repository.types';
import { CouponService } from './coupon.service';

/**
 * Coupon module composition root.
 *
 * Route handlers and pages call `getCouponService()` and never construct a
 * repository, so the credential-free fallback rule lives in exactly one place.
 */

export type CouponBackend = 'postgres' | 'memory';

let warnedAboutMemory = false;

/**
 * Chooses the repository.
 *
 * PostgreSQL when a database is configured; the in-memory fixtures otherwise, so a
 * fresh clone and the public preview both have working coupons.
 *
 * In PRODUCTION the in-memory repository is never used. It cannot count redemptions
 * or see order history, so every usage limit and first-order rule would silently
 * pass — a coupon that should be exhausted would keep discounting real money. A 503
 * is far better than that.
 */
export function resolveCouponBackend(): CouponBackend {
  const env = getServerEnv();

  if (isDatabaseConfigured()) return 'postgres';
  if (env.APP_ENV === 'production') return 'postgres';

  if (!warnedAboutMemory) {
    warnedAboutMemory = true;
    logger.info('Using in-memory coupon fixtures — no database configured', {
      appEnv: env.APP_ENV,
    });
  }

  return 'memory';
}

async function createRepository(): Promise<CouponRepository> {
  if (resolveCouponBackend() === 'memory') {
    return new InMemoryCouponRepository();
  }

  // Throws ConfigurationError (503) when unreachable, which is the correct
  // production failure.
  const db = await getDb();
  return createCouponRepository({ db });
}

export async function getCouponService(): Promise<CouponService> {
  return new CouponService({ repository: await createRepository() });
}

/** Backend status for development diagnostics. */
export function describeCouponBackend(): {
  backend: CouponBackend;
  databaseConfigured: boolean;
  codes: string[] | null;
} {
  const backend = resolveCouponBackend();

  return {
    backend,
    databaseConfigured: isDatabaseConfigured(),
    codes: backend === 'memory' ? inMemoryCouponSummary().codes : null,
  };
}

/** Test-only: clears the one-time log guard. */
export function resetCouponBackendWarningForTests(): void {
  warnedAboutMemory = false;
}

export { evaluateCoupon } from './coupon.engine';
export { InMemoryCouponRepository } from './coupon-memory.repository';
export { DrizzleCouponRepository, createCouponRepository } from './coupon.repository';
export { CouponService, createCouponService, toAppliedDiscount } from './coupon.service';
export { applyCouponSchema, couponCodeSchema, MAX_COUPON_CODE_LENGTH } from './coupon.schema';
export type { ApplyCouponBody } from './coupon.schema';
export type { ApplyCouponInput, CouponServiceDeps } from './coupon.service';
export type { CouponRepository } from './coupon.repository.types';
export type {
  Coupon,
  CouponAccepted,
  CouponCartLine,
  CouponEvaluation,
  CouponEvaluationContext,
  CouponRejected,
  CouponRejectionCode,
  CouponRestriction,
  CouponRestrictionType,
  CouponScope,
  CouponType,
  OfferSummary,
} from './coupon.types';
