import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { updateAdminRolePermissions } from '@/modules/admin-access';

const schema = z.object({
  permissionKeys: z.array(z.string().min(1).max(100)).max(200),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('role:manage');
    const { roleId } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the permission selection.');
    }

    return apiSuccess(
      await updateAdminRolePermissions(roleId, parsed.data.permissionKeys, actor.userId),
      { meta: { requestId } }
    );
  } catch (error) {
    return apiError(error, { requestId });
  }
}
