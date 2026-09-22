import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { updateAdminCmsPage } from '@/modules/admin-cms';
import { cmsPageSchema } from '../route';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('cms:manage');
    const { id } = await params;
    const parsed = cmsPageSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the CMS page fields.', parsed.error.flatten().fieldErrors);
    }
    return apiSuccess(await updateAdminCmsPage(id, parsed.data, actor.userId), {
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
