import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { cashAdjustmentBodySchema, getCashService } from '@/modules/cash';

/**
 * POST /api/v1/admin/cash/adjustments — a signed correction to a driver's float (`cash:adjust`).
 *
 * The one operation that can change a float without anybody counting money, which is exactly why
 * it sits behind its own permission held by a single role (docs/SECURITY.md §5.2). Negative writes
 * cash off; positive puts it back.
 *
 * A REASON IS MANDATORY, because the reason IS the audit trail. An adjustment nobody can explain
 * afterwards is indistinguishable from cash going missing with a tidy ledger.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentPermission('cash:adjust');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A JSON body is required.');
    }

    const parsed = cashAdjustmentBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Check the adjustment details.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const cash = await getCashService();
    const result = await cash.recordAdjustment({
      driverId: parsed.data.driverId,
      amountPaise: parsed.data.amountPaise,
      reason: parsed.data.reason,
      createdByUserId: actor.userId,
      isWriteOff: parsed.data.isWriteOff ?? false,
    });

    const response = apiSuccess(
      { adjustmentId: result.id, cashInHandPaise: result.cashInHandPaise },
      { status: 201, meta: { requestId, locale } }
    );

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
