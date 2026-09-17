import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { requireVendorActor } from '@/lib/http/vendor-scope';
import {
  readVendorProductForEdit,
  updateVendorProduct,
  vendorProductUpdateSchema,
} from '@/modules/vendor-products';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const requestId = requestIdFrom(request);

  try {
    const { vendorId } = await requireVendorActor('product:view');
    const { productId } = await params;
    const product = await readVendorProductForEdit(vendorId, productId);
    if (!product) return apiSuccess(null, { status: 404, meta: { requestId } });
    return apiSuccess(product, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const requestId = requestIdFrom(request);

  try {
    const { actor, vendorId } = await requireVendorActor('product:manage');
    const { productId } = await params;
    const parsed = vendorProductUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError('Check the product details and try again.', parsed.error.flatten().fieldErrors);
    }

    const product = await updateVendorProduct(vendorId, productId, actor.userId, parsed.data);
    return apiSuccess(product, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
