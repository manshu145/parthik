/**
 * Delivery OTP (D-20, docs/SECURITY.md §3).
 *
 * MANDATORY, not a nicety. The OTP is the only evidence that a human actually received the
 * order: without it a driver can mark ten deliveries complete from a car park, and the first
 * anyone hears of it is a customer complaint days later (threat T14).
 *
 * Rules this file enforces, all from SECURITY.md §3:
 *   * 6 digits from `crypto.getRandomValues` — never `Math.random`, which is predictable
 *     enough to guess a code from a couple of observed samples
 *   * stored as a SHA-256 HASH, never in plaintext and never logged
 *   * compared in constant time
 *   * capped attempts, enforced by the caller against `deliveries.otp_attempts`
 *
 * Web Crypto throughout, so it behaves identically on Cloudflare Workers.
 */

export const OTP_LENGTH = 6;
/** SECURITY.md §3 and §6: five verification attempts per delivery. */
export const MAX_OTP_ATTEMPTS = 5;
/**
 * How many times a customer may ask for a fresh code.
 *
 * Bounded because each regeneration invalidates the one the driver may already be holding, so
 * an unbounded button is a way to make a delivery unconfirmable.
 */
export const MAX_OTP_REGENERATIONS = 5;

/**
 * A 6-digit code with a UNIFORM distribution.
 *
 * `value % 1_000_000` on a 32-bit integer would bias the low codes slightly, which is the kind
 * of detail that is invisible in testing and quietly narrows the search space. Rejection
 * sampling costs nothing here.
 */
export function generateOtp(): string {
  const limit = 1_000_000;
  // Largest multiple of `limit` that fits in 32 bits; anything above it is rejected.
  const ceiling = Math.floor(0xff_ff_ff_ff / limit) * limit;

  const buffer = new Uint32Array(1);
  let value: number;

  do {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  } while (value >= ceiling);

  return String(value % limit).padStart(OTP_LENGTH, '0');
}

/**
 * Hashes an OTP for storage.
 *
 * Plain SHA-256 rather than a slow KDF, deliberately: the input space is only a million codes,
 * so a KDF would not meaningfully protect a leaked hash — the real defences are the five-attempt
 * cap and the short lifetime. What the hash does buy is that a database dump, a log line or a
 * support screenshot never reveals a live code.
 */
export async function hashOtp(code: string, deliveryId: string): Promise<string> {
  /**
   * The delivery id is mixed in as a SALT.
   *
   * Without it, identical codes on two deliveries produce identical hashes, and a thousand rows
   * would let anyone build a lookup table for all million codes in one pass. With it, the table
   * has to be rebuilt per delivery, which is exactly the point.
   */
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${deliveryId}:${code}`)
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time comparison, so a wrong code leaks nothing about how wrong it was. */
export function otpHashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}

/** Whether a submitted code is even shaped like an OTP, before any hashing. */
export function isOtpShaped(code: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);
}
