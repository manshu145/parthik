import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { updateAdminUserAccess } from '@/modules/admin-access';

const schema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  adminRoleKeys: z.array(z.string().min(1).max(50)).max(5),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('admin_user:manage');
    const { userId } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the admin user access settings.');
    }

    return apiSuccess(await updateAdminUserAccess(userId, parsed.data, actor.userId), {
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
