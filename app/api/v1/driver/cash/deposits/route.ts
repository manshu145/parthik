import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { declareDepositBodySchema, getCashService } from '@/modules/cash';
import { getDeliveryService } from '@/modules/delivery';

/**
 * POST /api/v1/driver/cash/deposits — DECLARE a deposit.
 * GET  /api/v1/driver/cash/deposits — the driver's own declarations and their status.
 *
 * **DECLARING IS NOT SETTLING.** The float does not move here. It moves when an admin counts the
 * money and verifies it, and only by the amount they counted — otherwise a driver could zero their
 * own liability by filling in a form, which is the entire hole the two-step exists to close
 * (docs/ARCHITECTURE.md §11.2.1).
 */

export const dynamic = 'force-dynamic';

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

    const parsed = declareDepositBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Check the deposit details.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const [deliveries, cash] = await Promise.all([getDeliveryService(), getCashService()]);
    const driver = await deliveries.requireDriver(actor.userId);

    const result = await cash.declareDeposit({
      driverId: driver.id,
      declaredAmountPaise: parsed.data.declaredAmountPaise,
      method: parsed.data.method,
      reference: parsed.data.reference ?? null,
      proofKey: parsed.data.proofKey ?? null,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    const response = apiSuccess(
      {
        depositId: result.depositId,
        status: 'DECLARED',
        // Said in the response so no client can mistake a declaration for a settlement.
        requiresVerification: true,
      },
      { status: result.wasReplay ? 200 : 201, meta: { requestId, locale } }
    );

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const [deliveries, cash] = await Promise.all([getDeliveryService(), getCashService()]);
    const driver = await deliveries.requireDriver(actor.userId);
    const deposits = await cash.depositsFor(driver.id);

    const response = apiSuccess({ deposits }, { meta: { requestId, locale } });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
