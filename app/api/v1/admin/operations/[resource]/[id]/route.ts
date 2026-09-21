import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { isPermissionKey } from '@/modules/identity';
import { updateAdminOperation } from '@/modules/admin-operations';

export async function PATCH(request: Request, { params }: { params: Promise<{ resource: string; id: string }> }) {
  const requestId = requestIdFrom(request);
  try {
    const { resource, id } = await params;
    if (!isPermissionKey(resource)) throw new Error('Unknown admin resource.');
    const actor = await requireCurrentPermission(resource);
    const parsed = z.object({ action: z.enum(['enable', 'disable', 'approve', 'reject']) }).parse(await request.json());
    await updateAdminOperation(resource, id, parsed.action, actor.userId);
    return apiSuccess({ id, action: parsed.action }, { meta: { requestId } });
  } catch (error) { return apiError(error, { requestId }); }
}
