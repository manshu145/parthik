import { describe, expect, it } from 'vitest';
import { REDACTED, redact } from '@/lib/logger/redact';

/**
 * docs/SECURITY.md §9.4 requires a test asserting that known-sensitive keys are
 * stripped from logs. This is that test — the redaction denylist is only
 * trustworthy if it is continuously verified.
 */
describe('log redaction', () => {
  it('redacts every documented sensitive key', () => {
    const input = {
      otp: '123456',
      otpCode: '123456',
      code: '123456',
      password: 'hunter2',
      passwordHash: 'argon2id$...',
      sessionToken: 'abc',
      idToken: 'eyJ...',
      refreshToken: 'r-abc',
      authorization: 'Bearer abc',
      cookie: 'session=abc',
      apiKey: 'k-abc',
      privateKey: '-----BEGIN PRIVATE KEY-----',
      clientSecret: 's-abc',
      cardNumber: '4111111111111111',
      cvv: '123',
      accountNumber: '00011122233',
      ifsc: 'HDFC0001234',
      aadhaar: '1234 5678 9012',
      pan: 'ABCDE1234F',
      signature: 'sig',
    };

    const output = redact(input) as Record<string, unknown>;

    for (const key of Object.keys(input)) {
      expect(output[key], `${key} must be redacted`).toBe(REDACTED);
    }
  });

  it('omits full postal addresses', () => {
    const output = redact({ line1: '12 MG Road', line2: 'Near park' }) as Record<string, unknown>;
    expect(output.line1).toBe('[ADDRESS_OMITTED]');
    expect(output.line2).toBe('[ADDRESS_OMITTED]');
  });

  it('keeps non-sensitive operational fields intact', () => {
    const output = redact({
      requestId: 'req-1',
      orderId: 'ord-1',
      orderNumber: 'PK-2026-000123',
      quantity: 2,
      totalAmountPaise: 45_900,
    }) as Record<string, unknown>;

    expect(output).toEqual({
      requestId: 'req-1',
      orderId: 'ord-1',
      orderNumber: 'PK-2026-000123',
      quantity: 2,
      totalAmountPaise: 45_900,
    });
  });

  it('redacts nested structures', () => {
    const output = redact({
      user: { id: 'u1', session: { sessionToken: 'abc' } },
    }) as { user: { id: string; session: Record<string, unknown> } };

    expect(output.user.id).toBe('u1');
    expect(output.user.session.sessionToken).toBe(REDACTED);
  });

  it('truncates beyond a safe depth so logging cannot stall a request', () => {
    // Build a chain deeper than the depth limit.
    let deep: Record<string, unknown> = { value: 'bottom' };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };

    expect(JSON.stringify(redact(deep))).toContain('[TRUNCATED]');
  });

  it('serialises errors without losing the message', () => {
    const output = redact({ err: new Error('boom') }) as { err: { message: string } };
    expect(output.err.message).toBe('boom');
  });
});
