import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { requireVendorActor } from '@/lib/http/vendor-scope';
import { createVendorProduct, vendorProductInputSchema } from '@/modules/vendor-products';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const { actor, vendorId } = await requireVendorActor('product:manage');
    const parsed = vendorProductInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError('Check the product details and try again.', parsed.error.flatten().fieldErrors);
    }

    const product = await createVendorProduct(vendorId, actor.userId, parsed.data);
    return apiSuccess(product, { status: 201, meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
