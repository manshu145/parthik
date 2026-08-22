import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { resolveRequestLocale } from '@/lib/http/request-locale';
import { getCustomerService } from '@/modules/customer';
import { addressBodySchema, addressIdParamSchema } from '@/modules/customer/customer.schema';

/**
 * PUT    /api/v1/addresses/:addressId — replace an address.
 * PATCH  /api/v1/addresses/:addressId — make it the default.
 * DELETE /api/v1/addresses/:addressId — soft delete.
 *
 * Ownership is enforced in the REPOSITORY's WHERE clause, not by a check here, so an id
 * belonging to another customer is indistinguishable from one that does not exist. Telling
 * the two apart would confirm that an id belongs to somebody (docs/SECURITY.md §5.4).
 */

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ addressId: string }> };

async function readAddressId(context: Context): Promise<string> {
  const parsed = addressIdParamSchema.safeParse(await context.params);
  if (!parsed.success) throw new ValidationError('That address could not be found.');
  return parsed.data.addressId;
}

export async function PUT(request: Request, context: Context) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();
    const addressId = await readAddressId(context);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A JSON body is required.');
    }

    const parsed = addressBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Please check the address details.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getCustomerService();
    const address = await service.updateAddress(actor.userId, addressId, parsed.data);

    return apiSuccess({ address }, { meta: { requestId, locale } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}

export async function PATCH(request: Request, context: Context) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();
    const addressId = await readAddressId(context);

    const service = await getCustomerService();
    await service.setDefaultAddress(actor.userId, addressId);

    return apiSuccess({ addressId, isDefault: true }, { meta: { requestId, locale } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}

export async function DELETE(request: Request, context: Context) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();
    const addressId = await readAddressId(context);

    const service = await getCustomerService();
    await service.deleteAddress(actor.userId, addressId);

    return apiSuccess({ deleted: true }, { meta: { requestId, locale } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
