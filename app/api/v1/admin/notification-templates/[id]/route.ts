import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { reviseAdminNotificationTemplate } from '@/modules/admin-notifications';
import { revisionSchema } from '../route';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('template:manage');
    const { id } = await params;
    const parsed = revisionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the template fields.', parsed.error.flatten().fieldErrors);
    }
    return apiSuccess(await reviseAdminNotificationTemplate(id, parsed.data, actor.userId), {
      status: 201,
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
