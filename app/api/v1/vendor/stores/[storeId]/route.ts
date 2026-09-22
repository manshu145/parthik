import { z } from 'zod';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { requireVendorActor } from '@/lib/http/vendor-scope';
import { updateVendorStore } from '@/modules/vendor-operations';

const inputSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED', 'TEMPORARILY_CLOSED']),
  description: z.string().trim().max(2000).nullable(),
  deliveryRadiusKm: z.number().int().min(1).max(100).nullable(),
  codEnabled: z.boolean(),
  minOrderPaise: z.number().int().min(0).max(10000000),
  avgPrepTimeMinutes: z.number().int().min(1).max(240).nullable(),
  isAcceptingOrders: z.boolean(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const requestId = requestIdFrom(request);

  try {
    const { actor, vendorId } = await requireVendorActor('product:manage');
    const { storeId } = await params;
    const parsed = inputSchema.safeParse(await request.json());

    if (!parsed.success) {
      throw new ValidationError(
        'Check the store settings and try again.',
        parsed.error.flatten().fieldErrors
      );
    }

    const result = await updateVendorStore(vendorId, storeId, actor.userId, parsed.data);
    return apiSuccess(result, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
