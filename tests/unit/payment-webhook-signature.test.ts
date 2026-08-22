import { beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/config/env';
import { hmacSha256Hex, signaturesMatch, verifyHmacSignature } from '@/lib/payments/hmac';
import { MockPaymentProvider, buildMockWebhook } from '@/lib/payments/mock-provider';
import { RazorpayProvider, mapRazorpayEvent } from '@/lib/payments/razorpay-provider';

/**
 * Webhook signature and event-mapping tests.
 *
 * This is the front door of the money path: a webhook that verifies when it should not is a
 * stranger marking orders paid, and a webhook that fails to verify when it should is a customer
 * charged for an order that never confirms. Both are silent — the first looks like a successful
 * payment, the second like a slow one.
 *
 * The signature is computed with the SAME Web Crypto code that runs in production. Nothing here
 * is stubbed, so a change that breaks HMAC on Workers breaks these tests too.
 */

const SECRET = 'test-webhook-secret';

beforeEach(() => {
  resetEnvCacheForTests();
});

describe('HMAC-SHA256', () => {
  it('produces the documented digest for a known input', async () => {
    // RFC 4231-style fixed vector: if this changes, the algorithm or the encoding changed, and
    // every previously-signed payload would start failing.
    const digest = await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog');
    expect(digest).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('is stable across calls', async () => {
    const a = await hmacSha256Hex(SECRET, '{"a":1}');
    const b = await hmacSha256Hex(SECRET, '{"a":1}');
    expect(a).toBe(b);
  });

  it('changes completely when one byte of the payload changes', async () => {
    const a = await hmacSha256Hex(SECRET, '{"amount":45900}');
    const b = await hmacSha256Hex(SECRET, '{"amount":45901}');
    expect(a).not.toBe(b);
  });

  it('changes when the secret changes', async () => {
    const a = await hmacSha256Hex('secret-one', '{"a":1}');
    const b = await hmacSha256Hex('secret-two', '{"a":1}');
    expect(a).not.toBe(b);
  });

  it('emits a 64-character lower-case hex digest', async () => {
    const digest = await hmacSha256Hex(SECRET, 'payload');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('constant-time comparison', () => {
  it('accepts identical digests', () => {
    expect(signaturesMatch('abc123', 'abc123')).toBe(true);
  });

  it('rejects a difference in the FIRST character', () => {
    // The case a short-circuiting `===` would answer fastest, which is what leaks.
    expect(signaturesMatch('abc123', 'zbc123')).toBe(false);
  });

  it('rejects a difference in the LAST character', () => {
    expect(signaturesMatch('abc123', 'abc124')).toBe(false);
  });

  it('rejects a prefix', () => {
    expect(signaturesMatch('abc123', 'abc')).toBe(false);
  });

  it('rejects an empty candidate', () => {
    expect(signaturesMatch('abc123', '')).toBe(false);
  });
});

describe('verifyHmacSignature', () => {
  const body = '{"event":"payment.captured","payload":{}}';

  it('accepts a correct signature', async () => {
    const signature = await hmacSha256Hex(SECRET, body);
    expect(await verifyHmacSignature(SECRET, body, signature)).toBe(true);
  });

  it('accepts an upper-case digest', async () => {
    // Providers differ on casing, and a case mismatch would look exactly like a forgery.
    const signature = (await hmacSha256Hex(SECRET, body)).toUpperCase();
    expect(await verifyHmacSignature(SECRET, body, signature)).toBe(true);
  });

  it('tolerates surrounding whitespace from a header', async () => {
    const signature = `  ${await hmacSha256Hex(SECRET, body)}  `;
    expect(await verifyHmacSignature(SECRET, body, signature)).toBe(true);
  });

  it('rejects a MISSING signature rather than skipping the check', async () => {
    expect(await verifyHmacSignature(SECRET, body, null)).toBe(false);
    expect(await verifyHmacSignature(SECRET, body, undefined)).toBe(false);
    expect(await verifyHmacSignature(SECRET, body, '')).toBe(false);
  });

  it('rejects a signature computed over DIFFERENT bytes', async () => {
    // The re-serialisation trap: same object, different bytes. This is why the raw body is
    // read before any parsing.
    const signature = await hmacSha256Hex(SECRET, '{"event":"payment.captured","payload":{} }');
    expect(await verifyHmacSignature(SECRET, body, signature)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const signature = await hmacSha256Hex('not-the-secret', body);
    expect(await verifyHmacSignature(SECRET, body, signature)).toBe(false);
  });

  it('rejects a truncated signature', async () => {
    const signature = (await hmacSha256Hex(SECRET, body)).slice(0, 32);
    expect(await verifyHmacSignature(SECRET, body, signature)).toBe(false);
  });
});

describe('Razorpay event mapping', () => {
  const captured = {
    entity: 'event',
    event: 'payment.captured',
    created_at: 1_772_000_000,
    payload: {
      payment: {
        entity: {
          id: 'pay_abc123',
          order_id: 'order_abc123',
          amount: 45_900,
          currency: 'INR',
          status: 'captured',
          method: 'upi',
        },
      },
    },
  };

  it('extracts the payment, order, amount and event id', () => {
    const event = mapRazorpayEvent(captured, 'evt_123');

    expect(event).toMatchObject({
      provider: 'razorpay',
      providerEventId: 'evt_123',
      kind: 'PAYMENT_CAPTURED',
      providerPaymentId: 'pay_abc123',
      providerOrderId: 'order_abc123',
      amountPaise: 45_900,
      currency: 'INR',
    });
  });

  it('derives a replay key when the header is absent', () => {
    // Without this there would be no replay protection at all for a provider that omits the
    // header, and the unique index would have nothing to reject.
    const event = mapRazorpayEvent(captured, null);
    expect(event?.providerEventId).toBe('payment.captured:pay_abc123');
  });

  it('prefers the header id over the derived one', () => {
    const event = mapRazorpayEvent(captured, 'evt_from_header');
    expect(event?.providerEventId).toBe('evt_from_header');
  });

  it('keeps AUTHORIZED distinct from CAPTURED', () => {
    // An authorised payment holds money without taking it. Collapsing the two would ship an
    // order against a payment that was never captured.
    const event = mapRazorpayEvent({ ...captured, event: 'payment.authorized' }, 'evt_1');
    expect(event?.kind).toBe('PAYMENT_AUTHORIZED');
  });

  it('maps a failure with its code and message', () => {
    const event = mapRazorpayEvent(
      {
        ...captured,
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_fail',
              order_id: 'order_abc123',
              amount: 45_900,
              status: 'failed',
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Payment declined by bank',
            },
          },
        },
      },
      'evt_2'
    );

    expect(event).toMatchObject({
      kind: 'PAYMENT_FAILED',
      failureCode: 'BAD_REQUEST_ERROR',
      failureMessage: 'Payment declined by bank',
    });
  });

  it('maps a processed refund to its refund id', () => {
    const event = mapRazorpayEvent(
      {
        entity: 'event',
        event: 'refund.processed',
        created_at: 1_772_000_100,
        payload: {
          refund: {
            entity: { id: 'rfnd_1', payment_id: 'pay_abc123', amount: 1_000, status: 'processed' },
          },
        },
      },
      'evt_3'
    );

    expect(event).toMatchObject({
      kind: 'REFUND_PROCESSED',
      providerRefundId: 'rfnd_1',
      providerPaymentId: 'pay_abc123',
      amountPaise: 1_000,
    });
  });

  it('classifies an unknown event as OTHER rather than guessing', () => {
    const event = mapRazorpayEvent({ ...captured, event: 'payment.dispute.created' }, 'evt_4');
    expect(event?.kind).toBe('OTHER');
  });

  it('refuses a body with no event name', () => {
    expect(mapRazorpayEvent({ payload: {} }, 'evt_5')).toBeNull();
  });

  it('refuses a non-object body', () => {
    expect(mapRazorpayEvent('nope', 'evt_6')).toBeNull();
    expect(mapRazorpayEvent(null, 'evt_7')).toBeNull();
    expect(mapRazorpayEvent([1, 2, 3], 'evt_8')).toBeNull();
  });

  it('keeps the raw payload verbatim for the event log', () => {
    const event = mapRazorpayEvent(captured, 'evt_9');
    expect(event?.payload).toEqual(captured);
  });
});

describe('the Razorpay provider refuses to verify without a secret', () => {
  it('reports NOT_CONFIGURED instead of accepting the body', async () => {
    // "We could not check the signature" must never resolve to "the signature was fine".
    const provider = new RazorpayProvider();
    const result = await provider.verifyWebhook({ rawBody: '{}', signature: 'anything' });

    expect(result).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
  });

  it('reports itself unconfigured with no credentials', () => {
    const provider = new RazorpayProvider();
    expect(provider.isConfigured()).toBe(false);
    expect(provider.canVerifyWebhooks()).toBe(false);
  });
});

describe('the mock gateway enforces the same contract', () => {
  const provider = new MockPaymentProvider();

  it('accepts a correctly signed webhook', async () => {
    const built = await buildMockWebhook({
      event: 'payment.captured',
      providerPaymentId: 'pay_mock_paid_45900',
      providerOrderId: 'order_mock_abc',
      amountPaise: 45_900,
    });

    const result = await provider.verifyWebhook({
      rawBody: built.rawBody,
      signature: built.signature,
      eventId: built.eventId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.kind).toBe('PAYMENT_CAPTURED');
      expect(result.event.amountPaise).toBe(45_900);
      expect(result.event.provider).toBe('mock');
    }
  });

  it('REJECTS an unsigned webhook — it is not a yes-man', async () => {
    const built = await buildMockWebhook({
      event: 'payment.captured',
      providerPaymentId: 'pay_mock_paid_45900',
      amountPaise: 45_900,
    });

    const result = await provider.verifyWebhook({ rawBody: built.rawBody, signature: null });
    expect(result).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it('rejects a webhook signed with the wrong secret', async () => {
    const built = await buildMockWebhook({
      event: 'payment.captured',
      providerPaymentId: 'pay_mock_paid_45900',
      amountPaise: 45_900,
      secret: 'wrong-secret',
    });

    const result = await provider.verifyWebhook({
      rawBody: built.rawBody,
      signature: built.signature,
    });

    expect(result).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it('rejects a body that was modified after signing', async () => {
    const built = await buildMockWebhook({
      event: 'payment.captured',
      providerPaymentId: 'pay_mock_paid_45900',
      amountPaise: 45_900,
    });

    // The attack the signature exists to stop: same shape, bigger number.
    const tampered = built.rawBody.replace('45900', '1');

    const result = await provider.verifyWebhook({
      rawBody: tampered,
      signature: built.signature,
    });

    expect(result).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it('returns the SAME provider order id for a repeated idempotency key', async () => {
    // Matches Razorpay's idempotency header. A random id would let the mock pass a test the
    // real gateway would fail.
    const first = await provider.createIntent(intent('key-abc'));
    const second = await provider.createIntent(intent('key-abc'));
    const other = await provider.createIntent(intent('key-xyz'));

    expect(second.providerOrderId).toBe(first.providerOrderId);
    expect(other.providerOrderId).not.toBe(first.providerOrderId);
  });

  it('refuses a zero-amount intent, as the real gateway does', async () => {
    await expect(
      provider.createIntent({ ...intent('key-zero'), amountPaise: 0 })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('reports the amount encoded in the payment id, so a mismatch is testable', async () => {
    const snapshot = await provider.fetchPaymentStatus('pay_mock_paid_order_mock_abc_45900');

    expect(snapshot.status).toBe('PAID');
    expect(snapshot.amountPaise).toBe(45_900);
    expect(snapshot.providerOrderId).toBe('order_mock_abc');
  });

  it('reports a failed payment as FAILED with a code', async () => {
    const snapshot = await provider.fetchPaymentStatus('pay_mock_failed_45900');
    expect(snapshot.status).toBe('FAILED');
    expect(snapshot.failureCode).not.toBeNull();
  });

  it('reports an unknown payment as PENDING rather than paid', async () => {
    const snapshot = await provider.fetchPaymentStatus('pay_something_else');
    expect(snapshot.status).toBe('PENDING');
  });
});

function intent(key: string) {
  return {
    orderId: '11111111-1111-7111-8111-111111111111',
    orderNumber: 'PK-2026-000001',
    amountPaise: 45_900,
    currency: 'INR',
    idempotencyKey: key,
  };
}
