import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { createAdminHomeLayout } from '@/modules/admin-marketing';
import { homeSectionSchema } from '@/modules/homepage/homepage.schema';

export const adminHomeLayoutSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    isActive: z.boolean(),
    deliveryZoneId: z.string().uuid().nullable(),
    validFrom: z.coerce.date().nullable(),
    validUntil: z.coerce.date().nullable(),
    sections: z.array(homeSectionSchema).min(1).max(30),
  })
  .superRefine((value, ctx) => {
    if (value.validFrom && value.validUntil && value.validUntil <= value.validFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'End time must be after start time.',
      });
    }
  });

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('cms:manage');
    const parsed = adminHomeLayoutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the homepage layout.', parsed.error.flatten().fieldErrors);
    }

    return apiSuccess(await createAdminHomeLayout(parsed.data, actor.userId), {
      status: 201,
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
