import { ValidationError } from '@/lib/errors';
import { hmacSha256Hex, verifyHmacSignature } from './hmac';
import { mapRazorpayEvent } from './razorpay-provider';
import type {
  CreateIntentInput,
  CreateIntentResult,
  PaymentProvider,
  ProviderPaymentSnapshot,
  ProviderRefundStatus,
  RefundInput,
  RefundResult,
  WebhookRequest,
  WebhookVerification,
} from './types';

/**
 * Deterministic mock gateway.
 *
 * WHY THIS EXISTS: without it, nothing about payments could be tested. Razorpay needs a
 * merchant account with completed KYC, so a CI runner and a fresh clone have no way to create
 * an intent, no way to receive a webhook, and no way to prove that a replayed callback does
 * not confirm an order twice. Those are the exact paths where a mistake costs real money, so
 * they are the last ones that should go untested.
 *
 * IT IS NOT A YES-MAN. It enforces the same contract the real gateway does:
 *
 *   * webhooks must carry a VALID HMAC signature — computed with the same Web Crypto code
 *     path as production, just under a published development secret
 *   * the event envelope is Razorpay's, parsed by the SAME mapper, so the translation under
 *     test is the one that ships
 *   * amounts, currencies and event ids are all present and are checked by the caller
 *
 * A mock that accepted anything would let a broken webhook handler pass CI and fail in
 * production on the first real payment.
 *
 * It resolves only in development, preview and test. `lib/payments/provider-factory.ts`
 * refuses to hand it out in production, because taking a real customer's money through a fake
 * gateway is the one failure mode that must be impossible.
 */

/**
 * The development webhook secret.
 *
 * PUBLISHED ON PURPOSE — it must be knowable so a test or a check script can produce a valid
 * signature. It is not a credential: the mock provider is unreachable in production, so
 * knowing this value grants nothing. Hiding it would only mean the signature path stayed
 * untested, which is the outcome it exists to prevent.
 */
export const MOCK_WEBHOOK_SECRET = 'parthik-mock-webhook-secret';

/** Payment ids that resolve to a settled state, so a test can choose the outcome it needs. */
const PAID_PREFIX = 'pay_mock_paid';
const FAILED_PREFIX = 'pay_mock_failed';

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  /** The mock needs no credentials — that is the entire point. */
  isConfigured(): boolean {
    return true;
  }

  canVerifyWebhooks(): boolean {
    return true;
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    if (input.amountPaise <= 0) {
      // The real gateway rejects this too. Accepting it here would hide a zero-total bug until
      // production.
      throw new ValidationError('A payment intent needs a positive amount.');
    }

    /**
     * Derived from the idempotency key, not random.
     *
     * So a retried create returns the SAME provider order id, exactly as Razorpay's
     * idempotency header does. A random id would make the mock pass a test that the real
     * gateway would fail.
     */
    const providerOrderId = `order_mock_${await shortDigest(input.idempotencyKey)}`;

    return {
      providerOrderId,
      clientPayload: {
        provider: this.name,
        keyId: 'rzp_test_mock',
        providerOrderId,
        amountPaise: input.amountPaise,
        currency: input.currency,
      },
    };
  }

  async verifyWebhook(input: WebhookRequest): Promise<WebhookVerification> {
    const isValid = await verifyHmacSignature(MOCK_WEBHOOK_SECRET, input.rawBody, input.signature);
    // Enforced, not waved through. An unsigned body is refused by the mock exactly as it would
    // be by Razorpay.
    if (!isValid) return { ok: false, reason: 'SIGNATURE_INVALID' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      return { ok: false, reason: 'MALFORMED' };
    }

    const event = mapRazorpayEvent(parsed, input.eventId ?? null, this.name);
    if (!event) return { ok: false, reason: 'MALFORMED' };

    return { ok: true, event };
  }

  async fetchPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentSnapshot> {
    const status = providerPaymentId.startsWith(PAID_PREFIX)
      ? 'PAID'
      : providerPaymentId.startsWith(FAILED_PREFIX)
        ? 'FAILED'
        : 'PENDING';

    return {
      providerPaymentId,
      // Encoded in the id as pay_mock_paid_<order>_<amount> when a test needs the intent
      // check to pass; null otherwise, which the caller treats as unverifiable.
      providerOrderId: orderFromId(providerPaymentId),
      status,
      // The caller compares this against its own record, so a fixed amount would defeat the
      // mismatch check. Encoded in the id instead: pay_mock_paid_<amount>.
      amountPaise: amountFromId(providerPaymentId),
      currency: 'INR',
      method: 'upi',
      failureCode: status === 'FAILED' ? 'BAD_REQUEST_ERROR' : null,
      failureMessage: status === 'FAILED' ? 'The payment was declined by the mock gateway.' : null,
      capturedAt: status === 'PAID' ? new Date() : null,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      providerRefundId: `rfnd_mock_${await shortDigest(input.idempotencyKey)}`,
      status: 'COMPLETED',
      amountPaise: input.amountPaise,
    };
  }

  async fetchRefundStatus(providerRefundId: string): Promise<{ status: ProviderRefundStatus }> {
    return { status: providerRefundId.startsWith('rfnd_mock') ? 'COMPLETED' : 'INITIATED' };
  }
}

/**
 * Builds a signed mock webhook, for tests and `scripts/check-payment-flow.sh`.
 *
 * Returns the RAW body alongside the signature, and the caller must send that exact string.
 * Returning a parsed object would invite the caller to re-serialise it, which is precisely the
 * mistake that breaks a byte-exact HMAC.
 */
export async function buildMockWebhook(input: {
  event: 'payment.captured' | 'payment.authorized' | 'payment.failed' | 'refund.processed';
  providerPaymentId: string;
  providerOrderId?: string | undefined;
  amountPaise: number;
  eventId?: string | undefined;
  occurredAt?: Date | undefined;
  failureCode?: string | undefined;
  secret?: string | undefined;
}): Promise<{ rawBody: string; signature: string; eventId: string }> {
  const occurredAt = input.occurredAt ?? new Date();

  const body = {
    entity: 'event',
    account_id: 'acc_mock',
    event: input.event,
    contains: input.event.startsWith('refund') ? ['refund'] : ['payment'],
    created_at: Math.floor(occurredAt.getTime() / 1000),
    payload: input.event.startsWith('refund')
      ? {
          refund: {
            entity: {
              id: `rfnd_mock_${input.providerPaymentId}`,
              payment_id: input.providerPaymentId,
              amount: input.amountPaise,
              currency: 'INR',
              status: 'processed',
            },
          },
        }
      : {
          payment: {
            entity: {
              id: input.providerPaymentId,
              order_id: input.providerOrderId ?? null,
              amount: input.amountPaise,
              currency: 'INR',
              status:
                input.event === 'payment.captured'
                  ? 'captured'
                  : input.event === 'payment.authorized'
                    ? 'authorized'
                    : 'failed',
              method: 'upi',
              error_code: input.failureCode ?? null,
              error_description: input.failureCode ? 'Mock decline' : null,
            },
          },
        },
  };

  const rawBody = JSON.stringify(body);
  const signature = await hmacSha256Hex(input.secret ?? MOCK_WEBHOOK_SECRET, rawBody);

  return {
    rawBody,
    signature,
    eventId: input.eventId ?? `evt_mock_${input.event}_${input.providerPaymentId}`,
  };
}

/** A redaction-safe summary for the diagnostics endpoint. */
export function describeMockGateway(): Record<string, string> {
  return {
    paidPaymentIdPrefix: `${PAID_PREFIX}_<amountPaise>`,
    failedPaymentIdPrefix: `${FAILED_PREFIX}_<amountPaise>`,
    webhookSecret: 'published in lib/payments/mock-provider.ts (development only)',
  };
}

/** `pay_mock_paid_order_mock_ab12_45900` → `order_mock_ab12`, so the intent check is testable. */
function orderFromId(providerPaymentId: string): string | null {
  const match = /_(order_mock_[0-9a-f]+)_/.exec(providerPaymentId);
  return match?.[1] ?? null;
}

/** `pay_mock_paid_45900` → 45900. Lets a test control the amount the gateway reports. */
function amountFromId(providerPaymentId: string): number {
  const trailing = /_(\d+)$/.exec(providerPaymentId);
  return trailing?.[1] ? Number(trailing[1]) : 0;
}

/** Short, stable hex digest. Web Crypto, so it behaves identically on Workers. */
async function shortDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));

  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
