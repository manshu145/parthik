/**
 * HMAC-SHA256 for provider webhook signatures.
 *
 * WEB CRYPTO, NOT `node:crypto`. The webhook route runs on Cloudflare Workers, where
 * `node:crypto` is not available — the same reason `lib/auth/session-token.ts` hashes with
 * `crypto.subtle` and `lib/firebase/verify-id-token.ts` verifies RS256 by hand instead of
 * using the Firebase Admin SDK. Reaching for `createHmac` here would work in `pnpm test`,
 * work in `pnpm dev`, and fail only in production.
 */

/** Hex-encoded HMAC-SHA256 of `payload` under `secret`. */
export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `a === b` on strings short-circuits at the first differing character, which leaks how much
 * of a forged signature was correct — enough, with many attempts, to construct a valid one a
 * byte at a time. Same implementation as `hashesMatch` in `lib/auth/session-token.ts`; kept
 * here rather than imported so the payments layer does not depend on the auth layer for a
 * primitive.
 */
export function signaturesMatch(a: string, b: string): boolean {
  // The length itself is not a secret, and comparing digests of different lengths cannot be
  // done in constant time anyway.
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}

/** Verifies a hex signature over the exact raw bytes it was computed on. */
export async function verifyHmacSignature(
  secret: string,
  rawBody: string,
  signature: string | null | undefined
): Promise<boolean> {
  if (!signature) return false;

  const expected = await hmacSha256Hex(secret, rawBody);
  // Normalised to lower case because providers differ on digest casing, and a case mismatch
  // would look exactly like a forgery.
  return signaturesMatch(expected, signature.trim().toLowerCase());
}
