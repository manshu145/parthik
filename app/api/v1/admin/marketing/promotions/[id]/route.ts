import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { updateAdminPromotion } from '@/modules/admin-marketing';
import { adminPromotionSchema } from '../route';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('promotion:manage');
    const { id } = await params;
    const parsed = adminPromotionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the promotion fields.', parsed.error.flatten().fieldErrors);
    }
    return apiSuccess(await updateAdminPromotion(id, parsed.data, actor.userId), {
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
