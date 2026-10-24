import { describe, expect, it } from 'vitest';
import {
  generateOtp,
  hashOtp,
  isOtpShaped,
  MAX_OTP_ATTEMPTS,
  MAX_OTP_REGENERATIONS,
  otpHashesMatch,
  OTP_LENGTH,
} from '@/modules/delivery/delivery.otp';

/**
 * Delivery OTP tests (D-20, docs/SECURITY.md §3).
 *
 * The OTP is the only evidence that a human actually received an order. If it is guessable, or if
 * a wrong code can be retried forever, a driver can mark deliveries complete from a car park and
 * the first anyone hears of it is a customer complaint (threat T14). So these tests are about the
 * properties that make guessing impractical rather than about the happy path.
 */

describe('generation', () => {
  it('is always exactly six digits', async () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it('keeps leading zeros', () => {
    // A code stored as a number would render "004821" as "4821" and never match. Generated as a
    // padded string for exactly that reason.
    const codes = Array.from({ length: 500 }, () => generateOtp());
    expect(codes.every((code) => code.length === OTP_LENGTH)).toBe(true);
  });

  it('does not repeat itself in any small sample', () => {
    // A million-code space: 300 draws should be essentially all distinct. A generator stuck on a
    // constant, or seeded per process, fails here.
    const codes = new Set(Array.from({ length: 300 }, () => generateOtp()));
    expect(codes.size).toBeGreaterThan(290);
  });

  it('spreads codes across the whole range rather than clustering low', () => {
    /**
     * Guards the rejection sampling.
     *
     * `random % 1_000_000` biases low codes slightly — invisible in testing, but it narrows the
     * search space for anyone guessing. With a uniform distribution roughly half the codes should
     * land above 500000.
     */
    const codes = Array.from({ length: 1_000 }, () => Number(generateOtp()));
    const high = codes.filter((code) => code >= 500_000).length;

    expect(high).toBeGreaterThan(380);
    expect(high).toBeLessThan(620);
  });
});

describe('shape check', () => {
  it('accepts a six-digit code', () => {
    expect(isOtpShaped('418322')).toBe(true);
    expect(isOtpShaped('000000')).toBe(true);
  });

  it('rejects anything else, before an attempt is spent', () => {
    // A mistyped five-digit code is not a guess, and burning one of five attempts on it would be
    // unfair to a driver standing at a door.
    for (const value of ['41832', '4183221', '41832a', '', ' 418322', '41 832']) {
      expect(isOtpShaped(value), value).toBe(false);
    }
  });
});

describe('hashing', () => {
  it('produces a 64-character hex digest', async () => {
    const digest = await hashOtp('418322', 'delivery-1');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same code and delivery', async () => {
    const a = await hashOtp('418322', 'delivery-1');
    const b = await hashOtp('418322', 'delivery-1');
    expect(a).toBe(b);
  });

  it('SALTS with the delivery id', async () => {
    /**
     * The property that makes a leaked table useless.
     *
     * Without the salt, the same code hashes identically everywhere, and one pass over a million
     * codes would build a lookup table for every live delivery at once. With it, the table has to
     * be rebuilt per delivery.
     */
    const a = await hashOtp('418322', 'delivery-1');
    const b = await hashOtp('418322', 'delivery-2');
    expect(a).not.toBe(b);
  });

  it('changes completely when one digit changes', async () => {
    const a = await hashOtp('418322', 'delivery-1');
    const b = await hashOtp('418323', 'delivery-1');
    expect(a).not.toBe(b);
  });

  it('never contains the code itself', async () => {
    // The whole point of storing a hash: a database dump, a log line or a support screenshot must
    // not reveal a live code.
    const digest = await hashOtp('418322', 'delivery-1');
    expect(digest).not.toContain('418322');
  });
});

describe('comparison', () => {
  it('accepts identical digests', async () => {
    const digest = await hashOtp('418322', 'delivery-1');
    expect(otpHashesMatch(digest, digest)).toBe(true);
  });

  it('rejects a digest that differs in the first character', () => {
    expect(otpHashesMatch('abc123', 'zbc123')).toBe(false);
  });

  it('rejects a digest that differs in the last character', () => {
    // The case a short-circuiting `===` answers slowest, which is what leaks how close a guess was.
    expect(otpHashesMatch('abc123', 'abc124')).toBe(false);
  });

  it('rejects a prefix and an empty candidate', () => {
    expect(otpHashesMatch('abc123', 'abc')).toBe(false);
    expect(otpHashesMatch('abc123', '')).toBe(false);
  });

  it('rejects a mismatched code hashed for the same delivery', async () => {
    const stored = await hashOtp('418322', 'delivery-1');
    const submitted = await hashOtp('999999', 'delivery-1');
    expect(otpHashesMatch(stored, submitted)).toBe(false);
  });

  it('rejects the RIGHT code hashed for the WRONG delivery', async () => {
    // Stops a code that is valid elsewhere from being replayed against this delivery.
    const stored = await hashOtp('418322', 'delivery-1');
    const submitted = await hashOtp('418322', 'delivery-2');
    expect(otpHashesMatch(stored, submitted)).toBe(false);
  });
});

describe('the caps are the real defence', () => {
  it('allows five verification attempts, as SECURITY.md §3 specifies', () => {
    /**
     * Five attempts against a million codes is a 1-in-200,000 chance of a blind guess. The hash
     * protects a leak; this number is what makes guessing pointless.
     */
    expect(MAX_OTP_ATTEMPTS).toBe(5);
  });

  it('bounds regeneration', () => {
    // Each reissue invalidates the code the driver may already be holding, so an unbounded button
    // would be a way to make a delivery unconfirmable.
    expect(MAX_OTP_REGENERATIONS).toBeGreaterThan(0);
    expect(MAX_OTP_REGENERATIONS).toBeLessThanOrEqual(10);
  });
});
