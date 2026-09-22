import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { createAdminPromotion } from '@/modules/admin-marketing';

const ruleSchema = z.object({
  ruleKey: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/),
  ruleValue: z.unknown(),
});

export const adminPromotionSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    promotionType: z.enum([
      'BUY_X_GET_Y',
      'CATEGORY_DISCOUNT',
      'VENDOR_CAMPAIGN',
      'FLASH_SALE',
      'FREE_DELIVERY',
      'NEW_CUSTOMER',
    ]),
    description: z.string().trim().max(2000).nullable(),
    bannerId: z.string().uuid().nullable(),
    priority: z.number().int().min(-32768).max(32767),
    validFrom: z.coerce.date().nullable(),
    validUntil: z.coerce.date().nullable(),
    isActive: z.boolean(),
    zoneScope: z.string().uuid().nullable(),
    rules: z.array(ruleSchema).max(100),
  })
  .superRefine((value, ctx) => {
    if (value.validFrom && value.validUntil && value.validUntil <= value.validFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'End time must be after start time.',
      });
    }
    if (value.isActive && value.promotionType !== 'FREE_DELIVERY') {
      ctx.addIssue({
        code: 'custom',
        path: ['isActive'],
        message:
          'Only FREE_DELIVERY promotions can be activated until the other pricing semantics are approved.',
      });
    }
  });

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('promotion:manage');
    const parsed = adminPromotionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the promotion fields.', parsed.error.flatten().fieldErrors);
    }
    return apiSuccess(await createAdminPromotion(parsed.data, actor.userId), {
      status: 201,
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
