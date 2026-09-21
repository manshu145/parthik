import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { listProviderSettings, saveProviderSettings } from '@/modules/provider-settings';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    await requireCurrentPermission('setting:manage_sensitive');
    return apiSuccess({ settings: await listProviderSettings() }, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('setting:manage_sensitive');
    const parsed = z
      .record(z.string(), z.string().max(10000))
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return apiError(new Error('Invalid provider settings payload.'), { requestId });
    await saveProviderSettings(parsed.data, actor.userId);
    return apiSuccess({ settings: await listProviderSettings() }, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
