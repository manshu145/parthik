import { z } from 'zod';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { requireVendorActor } from '@/lib/http/vendor-scope';
import { markVendorNotificationRead } from '@/modules/vendor-operations';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  const requestId = requestIdFrom(request);

  try {
    const { actor, vendorId } = await requireVendorActor('notification:view');
    const { notificationId } = await params;
    const parsedId = z.string().uuid().safeParse(notificationId);

    if (!parsedId.success) {
      throw new ValidationError('The notification id is invalid.');
    }

    const result = await markVendorNotificationRead(vendorId, actor.userId, parsedId.data);
    return apiSuccess(result, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
