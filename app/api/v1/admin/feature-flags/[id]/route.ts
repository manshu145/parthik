import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { updateAdminFeatureFlag } from '@/modules/admin-access';

const schema = z.object({
  description: z.string().trim().max(1000).nullable(),
  isEnabled: z.boolean(),
  rolloutPercentage: z.number().int().min(0).max(100),
  enabledForRoles: z.array(z.string().min(1).max(50)).max(20),
  enabledForZones: z.array(z.string().uuid()).max(500),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('flag:manage');
    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError(
        'Check the feature flag fields.',
        parsed.error.flatten().fieldErrors
      );
    }

    return apiSuccess(
      await updateAdminFeatureFlag(id, parsed.data, actor.userId),
      { meta: { requestId } }
    );
  } catch (error) {
    return apiError(error, { requestId });
  }
}
