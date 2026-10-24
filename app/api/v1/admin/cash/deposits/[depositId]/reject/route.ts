import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { depositIdParamSchema, getCashService, rejectDepositBodySchema } from '@/modules/cash';

/**
 * POST /api/v1/admin/cash/deposits/:id/reject — the money never arrived (`cash:reconcile`).
 *
 * Only a DECLARED deposit can be rejected. Reversing a VERIFIED one would have to move the ledger,
 * and that is an ADJUSTMENT — a different, separately-permissioned decision, precisely so
 * "un-verifying" cannot be used to quietly undo a count.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ depositId: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentPermission('cash:reconcile');

    const params = depositIdParamSchema.safeParse(await context.params);
    if (!params.success) throw new ValidationError('That deposit could not be found.');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A reason is required.');
    }

    const parsed = rejectDepositBodySchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('A reason is required.');

    const cash = await getCashService();
    await cash.rejectDeposit({
      depositId: params.data.depositId,
      reason: parsed.data.reason,
      verifiedByUserId: actor.userId,
    });

    const response = apiSuccess({ rejected: true }, { meta: { requestId, locale } });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
