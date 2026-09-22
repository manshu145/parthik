import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { sendAdminNotification } from '@/modules/admin-notifications';

const schema = z.object({
  userId: z.string().uuid(),
  channel: z.enum(['PUSH', 'IN_APP']),
  category: z.enum(['ORDER', 'PROMOTION', 'ACCOUNT', 'SUPPORT']),
  eventKey: z.string().trim().min(2).max(120).regex(/^[A-Za-z0-9._-]+$/),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
  data: z.record(z.string(), z.string().max(500)).refine(
    (value) => Object.keys(value).length <= 30,
    'Notification data supports at most 30 keys.'
  ),
});

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('notification:manage');
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the notification fields.', parsed.error.flatten().fieldErrors);
    }
    return apiSuccess(await sendAdminNotification(parsed.data, actor.userId), {
      status: 201,
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
