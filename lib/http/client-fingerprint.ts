import { getServerEnv } from '@/lib/config/env';

/**
 * Deriving a request fingerprint for abuse detection (docs/SECURITY.md §2.4).
 *
 * The schema stores `ip_hash`, never a raw address, and that is deliberate: an IP is
 * personal data under Indian and EU regimes, but rate limiting only ever needs to ask
 * "is this the same origin as before?" — a question a hash answers perfectly well.
 * Storing the plaintext would add legal exposure for no functional gain.
 *
 * The hash is keyed with AUTH_SECRET so it is not reversible by rainbow table. The
 * IPv4 space is only 2^32, so an unkeyed SHA-256 of an address is trivially
 * invertible and would be pseudonymisation in name only.
 */

/** Longest User-Agent we will store, to bound the column and the logs. */
const MAX_USER_AGENT_LENGTH = 256;

export interface ClientFingerprint {
  ipHash: string | null;
  userAgent: string | null;
}

/**
 * Reads the client IP.
 *
 * `cf-connecting-ip` is preferred and is the only header we can actually trust here:
 * Cloudflare sets it at the edge and it cannot be spoofed by the client. Anything in
 * `x-forwarded-for` is attacker-controlled, so it is used only as a local-development
 * fallback where no edge is in front of the app. Trusting the left-most XFF entry in
 * production is the classic way to make an IP-based rate limit bypassable by adding a
 * header.
 */
export function readClientIp(request: Request): string | null {
  const cloudflareIp = request.headers.get('cf-connecting-ip');
  if (cloudflareIp) return cloudflareIp.trim();

  if (getServerEnv().APP_ENV === 'production') {
    // No trusted header in production means we would rather have no signal than a
    // forgeable one.
    return null;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || null;
}

/**
 * Keyed SHA-256 (HMAC) of the client IP, hex encoded.
 *
 * Returns null when there is no IP to hash or no secret to key with, so callers must
 * handle a missing signal rather than silently comparing hashes of empty strings —
 * which would make every anonymous request look like the same client and throttle
 * them all together.
 */
export async function hashClientIp(ip: string | null): Promise<string | null> {
  if (!ip) return null;

  const secret = getServerEnv().AUTH_SECRET;
  if (!secret) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function readUserAgent(request: Request): string | null {
  const userAgent = request.headers.get('user-agent');
  if (!userAgent) return null;
  return userAgent.slice(0, MAX_USER_AGENT_LENGTH);
}

/** Everything the identity service needs to record and throttle an attempt. */
export async function readClientFingerprint(request: Request): Promise<ClientFingerprint> {
  return {
    ipHash: await hashClientIp(readClientIp(request)),
    userAgent: readUserAgent(request),
  };
}
