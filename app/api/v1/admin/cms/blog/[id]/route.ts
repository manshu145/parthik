import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { updateAdminBlogPost } from '@/modules/blog';
import { adminBlogSchema } from '../route';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = requestIdFrom(request);

  try {
    const actor = await requireCurrentPermission('cms:manage');
    const { id } = await params;
    const parsed = adminBlogSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the blog fields.', parsed.error.flatten().fieldErrors);
    }

    return apiSuccess(await updateAdminBlogPost(id, parsed.data, actor.userId), {
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
