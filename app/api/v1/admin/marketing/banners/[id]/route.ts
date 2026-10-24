import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { updateAdminBanner } from '@/modules/admin-marketing';
import { adminBannerSchema } from '../route';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('banner:manage');
    const { id } = await params;
    const parsed = adminBannerSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the banner fields.', parsed.error.flatten().fieldErrors);
    }

    return apiSuccess(await updateAdminBanner(id, parsed.data, actor.userId), {
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
