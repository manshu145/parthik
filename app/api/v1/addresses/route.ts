import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { getCustomerService } from '@/modules/customer';
import { addressBodySchema } from '@/modules/customer/customer.schema';

/**
 * GET  /api/v1/addresses — the customer's address book (docs/API_SPEC.md §4).
 * POST /api/v1/addresses — save a new address.
 *
 * The body carries no `deliveryZoneId`. The zone is resolved server-side from the pincode,
 * because it determines the delivery fee and COD eligibility — a client-supplied zone would
 * be a pricing control.
 *
 * Each returned address is annotated with CURRENT serviceability rather than the zone
 * stored when it was saved. Zones change, and a stale "we deliver here" is how a customer
 * gets to payment before being told otherwise.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();
    const service = await getCustomerService();

    const addresses = await service.listAddresses(actor.userId);

    const response = apiSuccess(
      { addresses },
      { meta: { requestId, locale, total: addresses.length } }
    );

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

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
    const address = await service.createAddress(actor.userId, parsed.data);

    return apiSuccess({ address }, { status: 201, meta: { requestId, locale } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
