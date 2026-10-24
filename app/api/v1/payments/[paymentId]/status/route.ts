import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import {
  getPaymentService,
  paymentIdParamSchema,
  paymentStatusQuerySchema,
} from '@/modules/payment';

/**
 * GET /api/v1/payments/:paymentId/status — SERVER-VERIFIED payment status (docs/API_SPEC.md §6).
 *
 * The client MUST poll this rather than trusting the gateway SDK's success callback
 * (docs/SECURITY.md §8.1 rule 2). That callback runs in a browser the customer controls; this
 * answer comes from our own record, and — when the payment is still open and a gateway reference
 * is offered — from asking the gateway directly.
 *
 * `?providerPaymentId=` is therefore a HINT, not evidence. The server fetches that payment from
 * the provider and checks it belongs to this order and carries the right amount before anything
 * settles, so pasting somebody else's captured payment id confirms nothing.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ paymentId: string }> }) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const params = paymentIdParamSchema.safeParse(await context.params);
    if (!params.success) throw new ValidationError('That payment could not be found.');

    const url = new URL(request.url);
    const query = paymentStatusQuerySchema.safeParse({
      providerPaymentId: url.searchParams.get('providerPaymentId') ?? undefined,
    });

    if (!query.success) throw new ValidationError('That payment reference is not valid.');

    const service = await getPaymentService();
    const status = await service.getStatusForUser({
      userId: actor.userId,
      paymentId: params.data.paymentId,
      providerPaymentIdHint: query.data.providerPaymentId,
    });

    const response = apiSuccess(status, {
      // `isPending` drives the client's polling, so it does not have to keep its own copy of
      // which statuses are still open.
      meta: { requestId, locale, isPending: status.isPending },
    });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
