import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { createAdminCoupon } from '@/modules/admin-marketing';
import { couponCodeSchema } from '@/modules/coupons';

const restrictionSchema = z.object({
  restrictionType: z.enum(['CATEGORY', 'PRODUCT', 'VENDOR', 'ZONE', 'USER']),
  restrictionId: z.string().uuid(),
});

export const adminCouponSchema = z
  .object({
    code: couponCodeSchema,
    couponType: z.enum(['FLAT', 'PERCENTAGE', 'FREE_DELIVERY']),
    discountValue: z.number().int().min(0).max(10_000_000),
    maxDiscountPaise: z.number().int().min(0).max(10_000_000).nullable(),
    minCartPaise: z.number().int().min(0).max(100_000_000),
    scope: z.enum(['CART', 'CATEGORY', 'PRODUCT', 'VENDOR', 'DELIVERY']),
    firstOrderOnly: z.boolean(),
    isUserSpecific: z.boolean(),
    usageLimitTotal: z.number().int().positive().max(10_000_000).nullable(),
    usageLimitPerUser: z.number().int().positive().max(1_000_000).nullable(),
    validFrom: z.coerce.date().nullable(),
    validUntil: z.coerce.date().nullable(),
    isActive: z.boolean(),
    isStackable: z.boolean(),
    nameEn: z.string().trim().min(1).max(200),
    descriptionEn: z.string().trim().max(2000).nullable(),
    nameHi: z.string().trim().min(1).max(200).nullable(),
    descriptionHi: z.string().trim().max(2000).nullable(),
    restrictions: z.array(restrictionSchema).max(500),
  })
  .superRefine((value, ctx) => {
    if (
      value.couponType === 'PERCENTAGE' &&
      (value.discountValue < 1 || value.discountValue > 100)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'Percentage must be between 1 and 100.',
      });
    }
    if (value.couponType === 'FLAT' && value.discountValue <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'Flat discount must be greater than zero.',
      });
    }
    if (value.couponType === 'FREE_DELIVERY' && value.discountValue !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'Free-delivery coupons must use discount value 0.',
      });
    }
    if (value.validFrom && value.validUntil && value.validUntil <= value.validFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'Expiry must be after the start time.',
      });
    }
    if (
      value.isUserSpecific &&
      !value.restrictions.some((item) => item.restrictionType === 'USER')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['restrictions'],
        message: 'User-specific coupons need at least one USER restriction.',
      });
    }
    const requiredRestriction =
      value.scope === 'CATEGORY'
        ? 'CATEGORY'
        : value.scope === 'PRODUCT'
          ? 'PRODUCT'
          : value.scope === 'VENDOR'
            ? 'VENDOR'
            : null;
    if (
      requiredRestriction &&
      !value.restrictions.some((item) => item.restrictionType === requiredRestriction)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['restrictions'],
        message: value.scope + ' scope needs at least one ' + requiredRestriction + ' restriction.',
      });
    }
  });

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('coupon:manage');
    const parsed = adminCouponSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the coupon fields.', parsed.error.flatten().fieldErrors);
    }

    return apiSuccess(await createAdminCoupon(parsed.data, actor.userId), {
      status: 201,
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
