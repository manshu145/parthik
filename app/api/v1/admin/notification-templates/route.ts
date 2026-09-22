import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { createAdminNotificationTemplate } from '@/modules/admin-notifications';

export const templateSchema = z.object({
  eventKey: z.string().trim().min(2).max(120).regex(/^[A-Za-z0-9._-]+$/),
  channel: z.enum(['PUSH', 'IN_APP']),
  locale: z.enum(['en', 'hi']),
  subject: z.string().trim().max(200).nullable(),
  body: z.string().trim().min(1).max(4000),
  variables: z.array(z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/)).max(50),
  isActive: z.boolean(),
});

export const revisionSchema = templateSchema.pick({
  subject: true,
  body: true,
  variables: true,
  isActive: true,
});

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('template:manage');
    const parsed = templateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the template fields.', parsed.error.flatten().fieldErrors);
    }
    return apiSuccess(await createAdminNotificationTemplate(parsed.data, actor.userId), {
      status: 201,
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
