import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { saveHindiTranslation } from '@/modules/admin-translations';

const schema = z.object({
  name: z.string().trim().min(1).max(500),
  description: z.string().trim().max(20000).nullable(),
  shortDescription: z.string().trim().max(4000).nullable(),
  unitLabel: z.string().trim().max(200).nullable(),
});

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ entity: 'category' | 'brand' | 'product'; id: string }>;
  }
) {
  const requestId = requestIdFrom(request);

  try {
    const actor = await requireCurrentPermission('cms:manage');
    const { entity, id } = await params;
    if (!['category', 'brand', 'product'].includes(entity)) {
      throw new ValidationError('Unsupported translation entity.');
    }

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the translation fields.', parsed.error.flatten().fieldErrors);
    }

    return apiSuccess(await saveHindiTranslation(entity, id, parsed.data, actor.userId), {
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
