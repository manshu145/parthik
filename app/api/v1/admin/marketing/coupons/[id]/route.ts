import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { updateAdminCoupon } from '@/modules/admin-marketing';
import { adminCouponSchema } from '../route';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('coupon:manage');
    const { id } = await params;
    const parsed = adminCouponSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the coupon fields.', parsed.error.flatten().fieldErrors);
    }

    return apiSuccess(await updateAdminCoupon(id, parsed.data, actor.userId), {
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
