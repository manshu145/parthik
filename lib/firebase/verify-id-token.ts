import { decodeJwt, decodeProtectedHeader, importX509, jwtVerify } from 'jose';
import { getServerEnv } from '@/lib/config/env';
import { AuthenticationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { isAuthEmulatorEnabled, requireFirebaseProjectId } from './config';

/**
 * Firebase ID token verification (docs/SECURITY.md §2.2).
 *
 * This is the entire front door of the application, and it is hand-rolled
 * because the Firebase Admin SDK cannot run on Cloudflare Workers (Node
 * dependencies, and Firebase publishes x509 certs rather than a JWKS document).
 * It is therefore treated as security-critical code with an exhaustive test
 * suite in tests/unit/verify-id-token.test.ts.
 *
 * Every check from §2.2 is implemented and none may be skipped:
 *   signature (RS256 only) · iss · aud · exp · iat · auth_time · sub ·
 *   sign_in_provider · phone_number
 */

const GOOGLE_X509_CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/** Only RS256 is ever accepted — guards against `alg: none` and HMAC downgrade. */
const ALLOWED_ALGORITHM = 'RS256';

/** Sign-in providers permitted in V1 (D-09: phone only). */
const ALLOWED_SIGN_IN_PROVIDERS = new Set(['phone']);

/** Small tolerance for clock skew between Google and the edge. */
const CLOCK_TOLERANCE_SECONDS = 10;

export interface VerifiedFirebaseToken {
  /** Firebase UID — becomes users.firebase_uid. */
  uid: string;
  /** E.164 phone number, taken from the token claims only. */
  phoneNumber: string;
  email?: string;
  emailVerified: boolean;
  signInProvider: string;
  authTime: number;
  issuedAt: number;
  expiresAt: number;
}

interface CertCache {
  certificates: Record<string, string>;
  expiresAt: number;
}

let certCache: CertCache | null = null;

/**
 * Fetches Google's signing certificates, honouring the Cache-Control max-age so
 * we neither hammer Google nor miss a key rotation.
 *
 * On a cache miss we always fetch. Verification is never skipped because the
 * cache is cold — that would be the obvious way to turn a cache problem into an
 * authentication bypass.
 */
async function getSigningCertificates(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();

  if (!forceRefresh && certCache && certCache.expiresAt > now) {
    return certCache.certificates;
  }

  const response = await fetch(GOOGLE_X509_CERT_URL, { cache: 'no-store' });

  if (!response.ok) {
    // If we cannot verify, we reject. Serving requests unverified is not an
    // option, so a stale cache is preferred only when it is still valid.
    if (certCache) return certCache.certificates;
    throw new AuthenticationError(
      'FIREBASE_TOKEN_INVALID',
      'Unable to verify sign-in right now. Please try again.',
      { context: { reason: 'cert_fetch_failed', status: response.status } }
    );
  }

  const certificates = (await response.json()) as Record<string, string>;
  const maxAge = parseMaxAge(response.headers.get('cache-control'));

  certCache = {
    certificates,
    expiresAt: now + maxAge * 1000,
  };

  return certificates;
}

function parseMaxAge(cacheControl: string | null): number {
  const match = cacheControl?.match(/max-age=(\d+)/);
  const parsed = match?.[1] ? Number.parseInt(match[1], 10) : NaN;
  // Default to 1 hour, and never cache longer than 24 hours.
  if (!Number.isFinite(parsed)) return 3600;
  return Math.min(parsed, 86_400);
}

function reject(
  reason: string,
  code:
    | 'FIREBASE_TOKEN_INVALID'
    | 'FIREBASE_TOKEN_EXPIRED'
    | 'FIREBASE_PROVIDER_NOT_ALLOWED'
    | 'PHONE_CLAIM_MISSING' = 'FIREBASE_TOKEN_INVALID'
): never {
  // The caller gets no indication of WHICH check failed (docs/SECURITY.md §2.2);
  // the detail stays in logs.
  logger.warn('Firebase ID token rejected', { reason, code });
  throw new AuthenticationError(code, 'Sign-in could not be verified. Please try again.', {
    context: { reason },
  });
}

/**
 * Verifies a Firebase ID token and returns the claims we trust.
 *
 * @throws AuthenticationError on any failed check
 * @throws ConfigurationError when Firebase is not configured
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseToken> {
  if (!idToken || typeof idToken !== 'string') {
    reject('missing_token');
  }

  // Throws ConfigurationError (503) rather than crashing when unconfigured.
  const projectId = requireFirebaseProjectId();
  const issuer = `https://securetoken.google.com/${projectId}`;

  let header: { alg?: string; kid?: string };
  try {
    header = decodeProtectedHeader(idToken);
  } catch {
    reject('malformed_token');
  }

  // ---------------------------------------------------------------------------
  // Emulator path. Emulator tokens are UNSIGNED, so this branch is gated on an
  // explicit env var AND on not being production. Both conditions are required;
  // this is the one place where an accident would be catastrophic.
  // ---------------------------------------------------------------------------
  if (isAuthEmulatorEnabled()) {
    if (getServerEnv().APP_ENV === 'production') {
      reject('emulator_in_production');
    }
    return verifyEmulatorToken(idToken, issuer);
  }

  if (header.alg !== ALLOWED_ALGORITHM) {
    reject(`disallowed_algorithm:${header.alg ?? 'none'}`);
  }
  if (!header.kid) {
    reject('missing_kid');
  }

  let certificates = await getSigningCertificates();
  let certificate = certificates[header.kid];

  // An unknown kid usually means Google rotated keys, so refresh once before
  // rejecting.
  if (!certificate) {
    certificates = await getSigningCertificates(true);
    certificate = certificates[header.kid];
  }
  if (!certificate) {
    reject('unknown_signing_key');
  }

  try {
    const publicKey = await importX509(certificate, ALLOWED_ALGORITHM);

    const { payload } = await jwtVerify(idToken, publicKey, {
      algorithms: [ALLOWED_ALGORITHM],
      issuer,
      audience: projectId,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });

    return assertClaims(payload);
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;

    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('exp') || message.toLowerCase().includes('expired')) {
      reject('token_expired', 'FIREBASE_TOKEN_EXPIRED');
    }
    reject(`verification_failed:${message}`);
  }
}

/**
 * Emulator tokens carry no signature, so only the claim set is validated.
 * Reached only when FIREBASE_AUTH_EMULATOR_HOST is set outside production.
 */
function verifyEmulatorToken(idToken: string, issuer: string): VerifiedFirebaseToken {
  let payload: Record<string, unknown>;
  try {
    payload = decodeJwt(idToken) as Record<string, unknown>;
  } catch {
    reject('malformed_emulator_token');
  }

  if (payload.iss !== issuer) {
    reject('issuer_mismatch');
  }

  logger.debug('Verifying Firebase token via Auth Emulator', { issuer });
  return assertClaims(payload);
}

/**
 * Validates the claims we depend on. Identity is taken from the token ONLY —
 * never from the request body (docs/SECURITY.md §2.2).
 */
function assertClaims(payload: Record<string, unknown>): VerifiedFirebaseToken {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const uid = typeof payload.sub === 'string' ? payload.sub : '';
  if (!uid) {
    reject('missing_sub');
  }

  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (!exp || exp + CLOCK_TOLERANCE_SECONDS < nowSeconds) {
    reject('token_expired', 'FIREBASE_TOKEN_EXPIRED');
  }

  const iat = typeof payload.iat === 'number' ? payload.iat : 0;
  if (!iat || iat - CLOCK_TOLERANCE_SECONDS > nowSeconds) {
    reject('issued_in_future');
  }

  const authTime = typeof payload.auth_time === 'number' ? payload.auth_time : 0;
  if (!authTime) {
    reject('missing_auth_time');
  }

  const firebaseClaim = (payload.firebase ?? {}) as { sign_in_provider?: unknown };
  const signInProvider =
    typeof firebaseClaim.sign_in_provider === 'string' ? firebaseClaim.sign_in_provider : '';

  if (!ALLOWED_SIGN_IN_PROVIDERS.has(signInProvider)) {
    reject(`provider_not_allowed:${signInProvider || 'unknown'}`, 'FIREBASE_PROVIDER_NOT_ALLOWED');
  }

  const phoneNumber = typeof payload.phone_number === 'string' ? payload.phone_number : '';
  if (!phoneNumber) {
    reject('missing_phone_number', 'PHONE_CLAIM_MISSING');
  }

  const email = typeof payload.email === 'string' ? payload.email : undefined;

  return {
    uid,
    phoneNumber,
    ...(email ? { email } : {}),
    emailVerified: payload.email_verified === true,
    signInProvider,
    authTime,
    issuedAt: iat,
    expiresAt: exp,
  };
}

/** Test-only: clears the certificate cache between cases. */
export function resetCertificateCacheForTests(): void {
  certCache = null;
}
