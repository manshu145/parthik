import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, ConfigurationError } from '@/lib/errors';
import { resetEnvCacheForTests } from '@/lib/config/env';
import {
  resetCertificateCacheForTests,
  verifyFirebaseIdToken,
} from '@/lib/firebase/verify-id-token';
import {
  buildUnsignedToken,
  createKeyMaterial,
  signToken,
  stubCertificateEndpoint,
  validClaims,
  TEST_PROJECT_ID,
  type TestKeyMaterial,
} from './helpers/firebase-token';

/**
 * Firebase ID token verification is the entire front door of the application and
 * is hand-rolled because the Admin SDK cannot run on Workers. docs/SECURITY.md
 * §2.2 lists the checks; every one of them gets a negative test here.
 *
 * A bug in this file is an authentication bypass, so the suite is deliberately
 * exhaustive rather than representative.
 */

let material: TestKeyMaterial;

beforeAll(async () => {
  material = await createKeyMaterial();
});

beforeEach(() => {
  resetEnvCacheForTests();
  resetCertificateCacheForTests();

  process.env.APP_ENV = 'development';
  process.env.FIREBASE_PROJECT_ID = TEST_PROJECT_ID;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

  vi.stubGlobal('fetch', vi.fn(stubCertificateEndpoint(material.certificatePem)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verifyFirebaseIdToken — happy path', () => {
  it('accepts a correctly signed token and returns trusted claims', async () => {
    const token = await signToken(material);
    const result = await verifyFirebaseIdToken(token);

    expect(result.uid).toBe('firebase-uid-123');
    expect(result.phoneNumber).toBe('+919876543210');
    expect(result.signInProvider).toBe('phone');
    expect(result.emailVerified).toBe(false);
  });

  it('takes identity from token claims, never from caller input', async () => {
    // The token says one number; nothing else may override it.
    const token = await signToken(material, {
      payload: { phone_number: '+911112223334', sub: 'uid-from-token' },
    });

    const result = await verifyFirebaseIdToken(token);
    expect(result.phoneNumber).toBe('+911112223334');
    expect(result.uid).toBe('uid-from-token');
  });

  it('caches certificates instead of refetching per request', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;

    await verifyFirebaseIdToken(await signToken(material));
    await verifyFirebaseIdToken(await signToken(material));

    expect(fetchMock.mock.calls.length).toBe(1);
  });
});

describe('verifyFirebaseIdToken — signature and algorithm', () => {
  it('rejects alg: none', async () => {
    const token = buildUnsignedToken(
      {
        ...validClaims(),
        iss: `https://securetoken.google.com/${TEST_PROJECT_ID}`,
        aud: TEST_PROJECT_ID,
      },
      'none'
    );

    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects an HMAC downgrade attempt', async () => {
    const token = buildUnsignedToken({ ...validClaims() }, 'HS256');
    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects a token signed by a different key', async () => {
    const attacker = await createKeyMaterial();
    // Attacker signs with their own key but claims the trusted kid.
    const token = await signToken(attacker);

    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects a tampered payload', async () => {
    const token = await signToken(material);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...validClaims(), sub: 'attacker' })).toString(
      'base64url'
    );

    await expect(verifyFirebaseIdToken(`${header}.${forged}.${signature}`)).rejects.toBeInstanceOf(
      AuthenticationError
    );
  });

  it('rejects a token with no kid', async () => {
    const token = await signToken(material, { kid: '' });
    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('refreshes certificates once when the kid is unknown, then rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(stubCertificateEndpoint(material.certificatePem, { kid: 'rotated-key' }))
    );

    const token = await signToken(material);
    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // One initial fetch plus one forced refresh for the rotation case.
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it('rejects malformed input', async () => {
    await expect(verifyFirebaseIdToken('not-a-jwt')).rejects.toBeInstanceOf(AuthenticationError);
    await expect(verifyFirebaseIdToken('')).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe('verifyFirebaseIdToken — claim validation', () => {
  it('rejects a wrong audience (token minted for another Firebase project)', async () => {
    const token = await signToken(material, { audience: 'someone-elses-project' });
    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects a wrong issuer', async () => {
    const token = await signToken(material, {
      issuer: 'https://securetoken.google.com/other-project',
    });
    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(material, {
      payload: { iat: now - 7200, exp: now - 3600 },
    });

    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects a token issued in the future', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(material, {
      payload: { iat: now + 600, exp: now + 4200 },
    });

    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects a missing auth_time', async () => {
    const token = await signToken(material, { payload: { auth_time: undefined } });
    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects an empty sub', async () => {
    const token = await signToken(material, { payload: { sub: '' } });
    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects a sign-in provider we have not enabled', async () => {
    // V1 is phone-only (D-09); a password or Google token must not be accepted.
    for (const provider of ['password', 'google.com', 'anonymous', 'custom']) {
      const token = await signToken(material, {
        payload: { firebase: { sign_in_provider: provider } },
      });

      await expect(
        verifyFirebaseIdToken(token),
        `provider ${provider} must be rejected`
      ).rejects.toBeInstanceOf(AuthenticationError);
    }
  });

  it('rejects a token with no phone_number claim', async () => {
    const token = await signToken(material, { payload: { phone_number: undefined } });
    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('never reveals which check failed', async () => {
    const token = await signToken(material, { payload: { sub: '' } });

    await expect(verifyFirebaseIdToken(token)).rejects.toThrowError(
      /Sign-in could not be verified/
    );
  });
});

describe('verifyFirebaseIdToken — configuration safety', () => {
  it('throws ConfigurationError, not a crash, when Firebase is unconfigured', async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    resetEnvCacheForTests();

    const token = await signToken(material);
    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(ConfigurationError);
  });
});

describe('verifyFirebaseIdToken — emulator path', () => {
  it('accepts an unsigned emulator token outside production', async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    resetEnvCacheForTests();

    const now = Math.floor(Date.now() / 1000);
    const token = buildUnsignedToken({
      ...validClaims(now),
      iss: `https://securetoken.google.com/${TEST_PROJECT_ID}`,
      aud: TEST_PROJECT_ID,
      iat: now,
      exp: now + 3600,
    });

    const result = await verifyFirebaseIdToken(token);
    expect(result.uid).toBe('firebase-uid-123');
  });

  it('REFUSES the emulator path in production even if the host is set', async () => {
    // This is the one branch where a mistake would be catastrophic, so it is
    // asserted explicitly rather than assumed from code reading.
    process.env.APP_ENV = 'production';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    resetEnvCacheForTests();

    const now = Math.floor(Date.now() / 1000);
    const token = buildUnsignedToken({
      ...validClaims(now),
      iss: `https://securetoken.google.com/${TEST_PROJECT_ID}`,
      aud: TEST_PROJECT_ID,
      iat: now,
      exp: now + 3600,
    });

    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('still validates the issuer on the emulator path', async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    resetEnvCacheForTests();

    const token = buildUnsignedToken({
      ...validClaims(),
      iss: 'https://securetoken.google.com/wrong-project',
      aud: TEST_PROJECT_ID,
    });

    await expect(verifyFirebaseIdToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });
});
