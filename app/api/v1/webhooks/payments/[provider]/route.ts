import { NextResponse } from 'next/server';
import { requestIdFrom } from '@/lib/http/api-response';
import { logger } from '@/lib/logger';
import { getPaymentService, webhookProviderParamSchema } from '@/modules/payment';

/**
 * POST /api/v1/webhooks/payments/:provider — the ONLY trusted source of payment truth
 * (docs/API_SPEC.md §6.3, docs/SECURITY.md §8.1).
 *
 * Four things make this route different from every other one in the app, and each is
 * deliberate:
 *
 *   1. **No session.** The caller is a payment provider, not a user. `requireCurrentActor()`
 *      would reject every legitimate call. Authentication is the HMAC signature instead.
 *
 *   2. **The RAW body is read first.** `await request.text()`, never `request.json()`. The
 *      signature covers exact bytes, and parse-then-re-serialise does not round-trip — a
 *      correct signature would start failing, or worse, verification would be done against
 *      different bytes than the ones we act on.
 *
 *   3. **The status codes are chosen for a RETRYING CALLER, not for a human.** A provider reads
 *      2xx as "delivered, stop" and 5xx as "try again":
 *        200 — processed, replayed, or unprocessable-and-will-never-be-processable. Retrying an
 *              event we cannot understand just wastes both sides' capacity, so it is logged and
 *              accepted.
 *        401 — signature invalid. Logged as a security event; a burst is an attack signal.
 *        500 — something broke on our side. This is the ONE case where a retry helps, and the
 *              provider's redelivery is what saves the payment.
 *
 *   4. **It replies quickly and never does slow work inline.** Notifications and analytics are
 *      enqueued after commit, not awaited, because a provider that times out retries and a
 *      slow handler turns one payment into five duplicate deliveries.
 */

export const dynamic = 'force-dynamic';

/** Razorpay's header names. The mock gateway uses the same ones so both take one code path. */
const SIGNATURE_HEADER = 'x-razorpay-signature';
const EVENT_ID_HEADER = 'x-razorpay-event-id';

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const requestId = requestIdFrom(request);

  const params = webhookProviderParamSchema.safeParse(await context.params);
  if (!params.success) {
    // An unknown provider in the path is not worth a retry, and answering 404 keeps the route
    // from being used to enumerate which providers exist.
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND' } }, { status: 404 });
  }

  // Read BEFORE any parsing. This is the string the signature was computed over.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_FAILED' } },
      { status: 400 }
    );
  }

  try {
    const service = await getPaymentService();

    const result = await service.handleWebhook({
      rawBody,
      signature: request.headers.get(SIGNATURE_HEADER),
      eventId: request.headers.get(EVENT_ID_HEADER),
      // The provider is taken from the PATH and must match the configured one. Otherwise a
      // deployment running the mock gateway would honour the mock's published development secret
      // at the `razorpay` path.
      expectedProvider: params.data.provider,
    });

    if (result.status === 'REJECTED') {
      /**
       * 401 for an invalid signature, and NOTHING is stored.
       *
       * `NOT_CONFIGURED` deliberately answers the same way: "we cannot check the signature" must
       * never resolve to "the signature was fine". A provider that keeps retrying against a
       * deployment with no webhook secret is the correct, visible outcome — the alternative is
       * accepting unverified instructions to mark orders paid.
       */
      logger.warn('Payment webhook refused', {
        requestId,
        provider: params.data.provider,
        reason: result.reason,
      });

      return NextResponse.json(
        { success: false, error: { code: 'WEBHOOK_SIGNATURE_INVALID' } },
        { status: 401 }
      );
    }

    logger.info('Payment webhook handled', {
      requestId,
      provider: params.data.provider,
      status: result.status,
      ...(result.status === 'PROCESSED' ? { kind: result.kind, outcome: result.outcome } : {}),
    });

    // 200 for processed, replayed and unprocessable alike: all three mean "do not send it again".
    return NextResponse.json({ success: true, data: { status: result.status } }, { status: 200 });
  } catch (error) {
    /**
     * 500, ON PURPOSE.
     *
     * The one case where the provider's retry is what rescues the payment: our database was
     * unreachable, or a transaction deadlocked. Answering 200 here would tell the provider the
     * event was handled and the customer's payment would be lost to us forever.
     */
    logger.exception(error, {
      requestId,
      provider: params.data.provider,
      scope: 'payment-webhook',
    });

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}
