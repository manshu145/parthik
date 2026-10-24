import { ProviderError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getGoogleAccessToken } from '@/lib/google/access-token';
import { requireFirebaseServerConfig } from './config';

/**
 * Privileged Firebase user operations via the Identity Platform REST API
 * (decision D-36).
 *
 * The Firebase Admin SDK cannot run on Cloudflare Workers, so the small number
 * of privileged operations we need are called over REST with a
 * service-account-signed token.
 *
 * TASK 001 provides only the operations the foundation and TASK 003 require.
 * Notably absent by design: setting custom claims. Roles live in PostgreSQL
 * (`user_roles`), never in Firebase claims, so authorization has exactly one
 * source of truth (docs/ARCHITECTURE.md §11.1).
 */

const IDENTITY_BASE = 'https://identitytoolkit.googleapis.com/v1';

export interface FirebaseUserRecord {
  uid: string;
  phoneNumber?: string;
  email?: string;
  disabled: boolean;
  /** Tokens issued before this time are invalid (seconds since epoch). */
  validSince?: number;
}

async function identityRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { projectId } = requireFirebaseServerConfig();
  const accessToken = await getGoogleAccessToken([
    'https://www.googleapis.com/auth/identitytoolkit',
  ]);

  const response = await fetch(`${IDENTITY_BASE}/projects/${projectId}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ProviderError('firebase-identity', `${path} failed (${response.status})`);
  }

  return (await response.json()) as T;
}

/** Looks up a Firebase user. Used for support tooling and account recovery. */
export async function lookupFirebaseUser(uid: string): Promise<FirebaseUserRecord | null> {
  const result = await identityRequest<{
    users?: Array<{
      localId: string;
      phoneNumber?: string;
      email?: string;
      disabled?: boolean;
      validSince?: string;
    }>;
  }>('/accounts:lookup', { localId: [uid] });

  const user = result.users?.[0];
  if (!user) return null;

  return {
    uid: user.localId,
    ...(user.phoneNumber ? { phoneNumber: user.phoneNumber } : {}),
    ...(user.email ? { email: user.email } : {}),
    disabled: user.disabled === true,
    ...(user.validSince ? { validSince: Number.parseInt(user.validSince, 10) } : {}),
  };
}

/**
 * Revokes all Firebase refresh tokens for a user.
 *
 * Required by `logout-all` (docs/SECURITY.md §3): revoking only our own session
 * would leave the client able to mint a fresh ID token and immediately
 * re-establish one.
 */
export async function revokeFirebaseRefreshTokens(uid: string): Promise<void> {
  await identityRequest('/accounts:update', {
    localId: uid,
    validSince: String(Math.floor(Date.now() / 1000)),
  });

  logger.info('Revoked Firebase refresh tokens', { firebaseUid: uid });
}

/**
 * Disables a Firebase account, used when a user is suspended or banned so they
 * cannot obtain new ID tokens at all.
 */
export async function setFirebaseUserDisabled(uid: string, disabled: boolean): Promise<void> {
  await identityRequest('/accounts:update', { localId: uid, disableUser: disabled });
  logger.info('Updated Firebase account state', { firebaseUid: uid, disabled });
}
