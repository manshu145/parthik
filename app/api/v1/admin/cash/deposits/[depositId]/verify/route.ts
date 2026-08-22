import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { depositIdParamSchema, getCashService, verifyDepositBodySchema } from '@/modules/cash';

/**
 * POST /api/v1/admin/cash/deposits/:id/verify — count it in (`cash:reconcile`).
 *
 * THE ONLY THING THAT REDUCES A DRIVER'S FLOAT, and it credits the amount actually COUNTED rather
 * than the amount declared. Any difference is stored as a variance and the deposit is marked
 * PARTIAL, so "settled cleanly" and "settled with a discrepancy" stay distinguishable — a driver
 * who is repeatedly short is a pattern somebody needs to see, not an average to be smoothed away.
 *
 * `cash:reconcile` is a separate permission from `cash:view` on purpose: looking at the queue and
 * moving money out of it are different jobs (docs/SECURITY.md §5.2).
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
      throw new ValidationError('Enter the amount you counted.');
    }

    const parsed = verifyDepositBodySchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Enter the amount you counted.');

    const cash = await getCashService();
    const result = await cash.verifyDeposit({
      depositId: params.data.depositId,
      verifiedAmountPaise: parsed.data.verifiedAmountPaise,
      verifiedByUserId: actor.userId,
      notes: parsed.data.notes ?? null,
    });

    const response = apiSuccess(
      {
        verified: true,
        variancePaise: result.variancePaise,
        // Non-zero means the counted amount differed from the declaration.
        hasVariance: result.variancePaise !== 0,
      },
      { meta: { requestId, locale } }
    );

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
