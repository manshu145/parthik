import { importPKCS8, SignJWT } from 'jose';
import { ProviderError } from '@/lib/errors';
import { requireFirebaseServerConfig } from '@/lib/firebase/config';

/**
 * Google service-account access tokens.
 *
 * Shared by every Google API we call server-side — Identity Platform REST
 * (D-36), FCM HTTP v1 (D-26) and Cloud Logging (D-27) — so the JWT-bearer flow
 * is implemented exactly once.
 *
 * This runs on Cloudflare Workers, so google-auth-library is not usable; the
 * self-signed JWT flow is implemented with Web Crypto via jose.
 *
 * SECURITY: this function is what makes FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY the
 * most sensitive secret in the system (docs/SECURITY.md §9.1). Tokens are cached
 * in memory only, never logged, and never returned to a client.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWT_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

/** Refresh slightly before expiry to avoid using a token mid-rotation. */
const EXPIRY_SKEW_SECONDS = 60;

export type GoogleScope =
  | 'https://www.googleapis.com/auth/cloud-platform'
  | 'https://www.googleapis.com/auth/firebase.messaging'
  | 'https://www.googleapis.com/auth/identitytoolkit'
  | 'https://www.googleapis.com/auth/logging.write';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export async function getGoogleAccessToken(scopes: GoogleScope[]): Promise<string> {
  const scope = scopes.join(' ');
  const cached = tokenCache.get(scope);
  const now = Math.floor(Date.now() / 1000);

  if (cached && cached.expiresAt - EXPIRY_SKEW_SECONDS > now) {
    return cached.accessToken;
  }

  // Throws ConfigurationError when the service account is absent.
  const { clientEmail, privateKey } = requireFirebaseServerConfig();

  let assertion: string;
  try {
    const key = await importPKCS8(privateKey, 'RS256');
    assertion = await new SignJWT({ scope })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(clientEmail)
      .setSubject(clientEmail)
      .setAudience(TOKEN_ENDPOINT)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
  } catch (error) {
    throw new ProviderError('google-oauth', 'Failed to sign service-account assertion', {
      cause: error,
    });
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: JWT_GRANT_TYPE, assertion }),
  });

  if (!response.ok) {
    // The response body can echo request details, so it is not logged verbatim.
    throw new ProviderError('google-oauth', `Token exchange failed (${response.status})`);
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new ProviderError('google-oauth', 'Token exchange returned no access_token');
  }

  tokenCache.set(scope, {
    accessToken: payload.access_token,
    expiresAt: now + (payload.expires_in ?? 3600),
  });

  return payload.access_token;
}

/** Test-only. */
export function resetAccessTokenCacheForTests(): void {
  tokenCache.clear();
}
