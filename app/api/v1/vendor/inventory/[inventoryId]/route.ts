import { z } from 'zod';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { requireVendorActor } from '@/lib/http/vendor-scope';
import { adjustVendorInventory } from '@/modules/vendor-inventory';

const inputSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-1000000)
    .max(1000000)
    .refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(1000),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ inventoryId: string }> }
) {
  const requestId = requestIdFrom(request);
  try {
    const { actor, vendorId } = await requireVendorActor('inventory:manage');
    const { inventoryId } = await params;
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        'Check the stock adjustment and try again.',
        parsed.error.flatten().fieldErrors
      );
    }

    const result = await adjustVendorInventory(
      vendorId,
      inventoryId,
      actor.userId,
      parsed.data.delta,
      parsed.data.reason
    );
    return apiSuccess(result, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
