import { z } from 'zod';

/**
 * Coupon input validation.
 *
 * The code is the only thing a customer supplies. Everything monetary is read
 * server-side, so there is deliberately no way to submit a discount amount.
 */

export const MAX_COUPON_CODE_LENGTH = 32;

/**
 * A coupon code.
 *
 * Uppercased here so `demofirst50` and `DEMOFIRST50` are the same request, and
 * bounded to letters, digits, hyphen and underscore — codes are typed by hand and
 * printed on flyers, so anything else is a mistake rather than a code we should
 * look up.
 */
export const couponCodeSchema = z
  .string()
  .trim()
  .min(3, 'Enter a coupon code.')
  .max(MAX_COUPON_CODE_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/, 'Coupon codes use letters, numbers, hyphens and underscores only.')
  .transform((code) => code.toUpperCase());

export const applyCouponSchema = z.object({ code: couponCodeSchema });

export type ApplyCouponBody = z.infer<typeof applyCouponSchema>;
