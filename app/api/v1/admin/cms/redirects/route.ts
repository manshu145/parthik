import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { createAdminRedirect } from '@/modules/admin-cms';
import { isSafeRedirectPath } from '@/modules/cms';

export const redirectSchema = z
  .object({
    sourcePath: z.string().trim().min(1).max(1000),
    targetPath: z.string().trim().min(1).max(1000),
    statusCode: z.union([z.literal(301), z.literal(302)]),
    isActive: z.boolean(),
    note: z.string().trim().max(1000).nullable(),
  })
  .superRefine((value, ctx) => {
    if (!isSafeRedirectPath(value.sourcePath)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourcePath'],
        message: 'Source must be a safe site-relative path.',
      });
    }
    if (!isSafeRedirectPath(value.targetPath)) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetPath'],
        message: 'Target must be a safe site-relative path.',
      });
    }
    if (value.sourcePath === value.targetPath) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetPath'],
        message: 'A redirect cannot point to itself.',
      });
    }
  });

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('cms:manage');
    const parsed = redirectSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the redirect fields.', parsed.error.flatten().fieldErrors);
    }
    return apiSuccess(await createAdminRedirect(parsed.data, actor.userId), {
      status: 201,
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
