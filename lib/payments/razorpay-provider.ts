import { ProviderError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getRazorpayKeyPairOrNull, getRazorpayWebhookSecretOrNull } from './config';
import { verifyHmacSignature } from './hmac';
import type {
  CreateIntentInput,
  CreateIntentResult,
  PaymentProvider,
  ProviderPaymentSnapshot,
  ProviderPaymentStatus,
  ProviderRefundStatus,
  RefundInput,
  RefundResult,
  VerifiedWebhookEvent,
  WebhookRequest,
  WebhookVerification,
} from './types';

/**
 * Razorpay adapter (D-13).
 *
 * Speaks the REST API directly rather than through the `razorpay` npm SDK, for the same
 * reason `lib/firebase/verify-id-token.ts` verifies tokens by hand: the SDK assumes Node,
 * and this runs on Cloudflare Workers. Four `fetch` calls are also easier to reason about
 * under audit than a dependency that could change its transport.
 *
 * PROVIDER VOCABULARY STOPS HERE. Razorpay's `captured`/`authorized`/`failed` and its
 * `payment.captured` event names are translated into our own enums inside this file, so a
 * change of provider — or a change in Razorpay's naming — cannot reach a service or a
 * database column.
 *
 * Amounts are in PAISE in both directions, which happens to match Razorpay's smallest-unit
 * convention. That coincidence is asserted, not assumed: `verifyWebhook` reports the amount
 * the provider claims and the service compares it against our own record before marking
 * anything paid.
 */

const API_BASE = 'https://api.razorpay.com/v1';

/**
 * How stale a provider event may be and still be processed.
 *
 * Deliberately GENEROUS. Razorpay retries a failed delivery for hours, and a narrow window
 * would silently discard a legitimate retry for a payment the customer has already made —
 * far worse than the replay it is meant to prevent. The real replay defence is the unique
 * index on `payment_events.provider_event_id`, which cannot be raced; this window only blunts
 * an attacker resending a captured body indefinitely.
 */
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';

  constructor(
    private readonly configured?: {
      keyId: string;
      keySecret: string;
      webhookSecret?: string | null;
    }
  ) {}

  isConfigured(): boolean {
    return Boolean(this.configured ?? getRazorpayKeyPairOrNull());
  }

  canVerifyWebhooks(): boolean {
    return Boolean(this.configured?.webhookSecret ?? getRazorpayWebhookSecretOrNull());
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const { keyId } = this.credentials();

    /**
     * `receipt` carries OUR order number, and `notes.orderId` our order id.
     *
     * This is what makes a payment traceable from the Razorpay dashboard back to an order
     * without a lookup table, which is the difference between a five-minute and a five-hour
     * reconciliation when finance asks about one transaction.
     */
    const body = await this.request<{ id: string; amount: number; currency: string }>(
      'POST',
      '/orders',
      {
        amount: input.amountPaise,
        currency: input.currency,
        receipt: input.orderNumber,
        notes: { orderId: input.orderId, orderNumber: input.orderNumber },
      },
      // Razorpay honours this header, so a retried create returns the SAME order instead of a
      // second one the customer could also pay.
      { 'X-Razorpay-Idempotency-Key': input.idempotencyKey }
    );

    return {
      providerOrderId: body.id,
      clientPayload: {
        provider: this.name,
        // The public key id, per request. A rotated key takes effect on the next intent
        // rather than on the next build, which a NEXT_PUBLIC_* variable could not do.
        keyId,
        providerOrderId: body.id,
        amountPaise: body.amount,
        currency: body.currency,
      },
    };
  }

  async verifyWebhook(input: WebhookRequest): Promise<WebhookVerification> {
    const secret = this.configured?.webhookSecret ?? getRazorpayWebhookSecretOrNull();
    // Refused rather than skipped. "We could not check the signature" must never resolve to
    // "the signature was fine".
    if (!secret) return { ok: false, reason: 'NOT_CONFIGURED' };

    const isValid = await verifyHmacSignature(secret, input.rawBody, input.signature);
    if (!isValid) return { ok: false, reason: 'SIGNATURE_INVALID' };

    let parsed: unknown;
    try {
      // Parsed only AFTER the signature is verified, so malformed input from an unverified
      // source never reaches the parser.
      parsed = JSON.parse(input.rawBody);
    } catch {
      return { ok: false, reason: 'MALFORMED' };
    }

    const event = mapRazorpayEvent(parsed, input.eventId ?? null);
    if (!event) return { ok: false, reason: 'MALFORMED' };

    if (event.occurredAt) {
      const age = (input.now ?? new Date()).getTime() - event.occurredAt.getTime();
      if (age > MAX_EVENT_AGE_MS) return { ok: false, reason: 'STALE' };
    }

    return { ok: true, event };
  }

  async fetchPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentSnapshot> {
    const body = await this.request<RazorpayPayment>('GET', `/payments/${providerPaymentId}`);

    return {
      providerPaymentId: body.id,
      providerOrderId: body.order_id ?? null,
      status: mapPaymentStatus(body.status),
      amountPaise: body.amount,
      currency: body.currency,
      method: body.method ?? null,
      failureCode: body.error_code ?? null,
      failureMessage: body.error_description ?? null,
      capturedAt: body.status === 'captured' ? secondsToDate(body.created_at) : null,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const body = await this.request<{ id: string; status: string; amount: number }>(
      'POST',
      `/payments/${input.providerPaymentId}/refund`,
      { amount: input.amountPaise, notes: input.notes ?? {} },
      // A retried refund must not pay the customer twice. This is the provider-side half of
      // the guarantee; the database-side half is the refund-sum check in the repository.
      { 'X-Razorpay-Idempotency-Key': input.idempotencyKey }
    );

    return {
      providerRefundId: body.id,
      status: mapRefundStatus(body.status),
      amountPaise: body.amount,
    };
  }

  async fetchRefundStatus(providerRefundId: string): Promise<{ status: ProviderRefundStatus }> {
    const body = await this.request<{ status: string }>('GET', `/refunds/${providerRefundId}`);
    return { status: mapRefundStatus(body.status) };
  }

  private credentials() {
    const pair = this.configured ?? getRazorpayKeyPairOrNull();

    if (!pair) {
      // Thrown at the point of USE, not at construction, so an unconfigured deployment still
      // boots and still serves everything that does not need a gateway.
      throw new ProviderError(
        this.name,
        'Razorpay credentials are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'
      );
    }

    return pair;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const { keyId, keySecret } = this.credentials();

    const headers: Record<string, string> = {
      // Basic auth over TLS is what Razorpay's API takes. `btoa` rather than `Buffer`, because
      // `Buffer` does not exist on Workers.
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      Accept: 'application/json',
      ...extraHeaders,
    };

    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      // A network failure is the provider being unavailable, not our bug: 502, not 500.
      throw new ProviderError(this.name, 'Could not reach Razorpay.', { cause });
    }

    const text = await response.text();

    if (!response.ok) {
      /**
       * The provider's own message is logged but NOT returned to the customer.
       *
       * Gateway errors routinely name internal account state, and "your merchant account is
       * not activated for UPI" is not something a shopper can act on — or should see.
       */
      logger.warn('Razorpay request failed', {
        path,
        status: response.status,
        body: text.slice(0, 500),
      });

      throw new ProviderError(this.name, `Razorpay request failed (${response.status}).`, {
        context: { path, status: response.status },
      });
    }

    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new ProviderError(this.name, 'Razorpay returned an unreadable response.', { cause });
    }
  }
}

interface RazorpayPayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  method?: string;
  order_id?: string;
  error_code?: string | null;
  error_description?: string | null;
  created_at?: number;
}

/** Razorpay's payment states, translated into ours. */
function mapPaymentStatus(status: string): ProviderPaymentStatus {
  switch (status) {
    case 'created':
      return 'CREATED';
    case 'authorized':
      // Authorised is NOT paid. The money is held, not taken, and treating the two as the
      // same is how an order ships against a payment that was never captured.
      return 'AUTHORIZED';
    case 'captured':
      return 'PAID';
    case 'refunded':
      return 'REFUNDED';
    case 'failed':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

function mapRefundStatus(status: string): ProviderRefundStatus {
  switch (status) {
    case 'processed':
      return 'COMPLETED';
    case 'failed':
      return 'FAILED';
    case 'pending':
      return 'PROCESSING';
    default:
      return 'INITIATED';
  }
}

function secondsToDate(seconds: number | undefined): Date | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

/**
 * Razorpay's event envelope, translated into a `VerifiedWebhookEvent`.
 *
 * Exported for the tests, which assert the mapping against recorded fixture bodies — the
 * translation is the part most likely to be wrong, and the part a live sandbox would only
 * exercise for whichever event happened to fire.
 */
export function mapRazorpayEvent(
  parsed: unknown,
  headerEventId: string | null,
  // The mock gateway emits the same envelope on purpose, so both providers exercise ONE
  // mapping rather than two that could drift.
  provider = 'razorpay'
): VerifiedWebhookEvent | null {
  if (!isRecord(parsed)) return null;

  const eventType = typeof parsed['event'] === 'string' ? parsed['event'] : null;
  if (!eventType) return null;

  const payload = isRecord(parsed['payload']) ? parsed['payload'] : {};
  const payment = isRecord(payload['payment']) ? readEntity(payload['payment']) : null;
  const refund = isRecord(payload['refund']) ? readEntity(payload['refund']) : null;
  const subject = payment ?? refund;

  const providerPaymentId = payment
    ? asString(payment['id'])
    : refund
      ? asString(refund['payment_id'])
      : null;

  /**
   * The replay key.
   *
   * Header first, because that is Razorpay's own event id and is unique per DELIVERY
   * ATTEMPT's logical event. The derived fallback keeps replay protection working if the
   * header is ever absent: two `payment.captured` events for the same payment are the same
   * event, so collapsing them is correct rather than lossy.
   */
  const providerEventId =
    headerEventId?.trim() ||
    (providerPaymentId ? `${eventType}:${providerPaymentId}` : null) ||
    (refund ? `${eventType}:${asString(refund['id'])}` : null);

  if (!providerEventId) return null;

  return {
    provider,
    providerEventId,
    kind: mapEventKind(eventType),
    eventType,
    providerPaymentId,
    providerOrderId: payment ? asString(payment['order_id']) : null,
    providerRefundId: refund ? asString(refund['id']) : null,
    amountPaise: typeof subject?.['amount'] === 'number' ? subject['amount'] : null,
    currency: asString(subject?.['currency']),
    failureCode: asString(payment?.['error_code']),
    failureMessage: asString(payment?.['error_description']),
    occurredAt:
      typeof parsed['created_at'] === 'number' ? new Date(parsed['created_at'] * 1000) : null,
    payload: parsed,
  };
}

/**
 * Normalises the event name.
 *
 * `payment.authorized` maps to its own kind rather than to captured, because an authorised
 * payment has not moved any money. Anything unrecognised becomes OTHER and is STORED but not
 * acted on — the log matters even when the meaning does not.
 */
function mapEventKind(eventType: string): VerifiedWebhookEvent['kind'] {
  switch (eventType) {
    case 'payment.captured':
      return 'PAYMENT_CAPTURED';
    case 'payment.authorized':
      return 'PAYMENT_AUTHORIZED';
    case 'payment.failed':
      return 'PAYMENT_FAILED';
    case 'refund.processed':
      return 'REFUND_PROCESSED';
    default:
      return 'OTHER';
  }
}

/** Razorpay nests each object as `{ entity: { … } }`. */
function readEntity(wrapper: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(wrapper['entity']) ? wrapper['entity'] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
