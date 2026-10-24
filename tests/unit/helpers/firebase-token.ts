import * as x509 from '@peculiar/x509';
import { SignJWT, type JWTPayload } from 'jose';
import { webcrypto } from 'node:crypto';

/**
 * Test helpers for Firebase ID token verification.
 *
 * docs/ARCHITECTURE.md §13.1 requires verifier tests to use a LOCAL key pair and
 * a stub certificate endpoint, and to never point at Google's live certs. This
 * module mints a real self-signed X.509 certificate so signature verification is
 * genuinely exercised rather than mocked away — the whole point is to prove the
 * hand-rolled verifier accepts only what it should.
 */

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

export const TEST_PROJECT_ID = 'parthik-test';
export const TEST_ISSUER = `https://securetoken.google.com/${TEST_PROJECT_ID}`;
export const TEST_KID = 'test-key-1';

export interface TestKeyMaterial {
  privateKey: CryptoKey;
  /** PEM-encoded self-signed certificate, as Google's endpoint would return. */
  certificatePem: string;
}

export async function createKeyMaterial(): Promise<TestKeyMaterial> {
  const algorithm: RsaHashedKeyGenParams = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  };

  const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);

  const certificate = await x509.X509CertificateGenerator.createSelfSigned(
    {
      serialNumber: '01',
      name: 'CN=securetoken.system.gserviceaccount.com',
      notBefore: new Date(Date.now() - 60_000),
      notAfter: new Date(Date.now() + 86_400_000),
      signingAlgorithm: algorithm,
      keys,
    },
    webcrypto as unknown as Crypto
  );

  return {
    privateKey: keys.privateKey,
    certificatePem: certificate.toString('pem'),
  };
}

export interface TokenOverrides {
  payload?: JWTPayload & Record<string, unknown>;
  algorithm?: string;
  kid?: string | undefined;
  issuer?: string;
  audience?: string;
}

/** A claim set that passes every check, used as the baseline for negative tests. */
export function validClaims(now = Math.floor(Date.now() / 1000)): Record<string, unknown> {
  return {
    sub: 'firebase-uid-123',
    auth_time: now - 30,
    phone_number: '+919876543210',
    firebase: { sign_in_provider: 'phone', identities: { phone: ['+919876543210'] } },
  };
}

export async function signToken(
  material: TestKeyMaterial,
  overrides: TokenOverrides = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...validClaims(now), ...(overrides.payload ?? {}) };

  const jwt = new SignJWT(claims as JWTPayload)
    .setProtectedHeader({
      alg: overrides.algorithm ?? 'RS256',
      ...(overrides.kid === undefined
        ? { kid: TEST_KID }
        : overrides.kid
          ? { kid: overrides.kid }
          : {}),
    })
    .setIssuer(overrides.issuer ?? TEST_ISSUER)
    .setAudience(overrides.audience ?? TEST_PROJECT_ID);

  if (claims.iat === undefined) jwt.setIssuedAt(now);
  if (claims.exp === undefined) jwt.setExpirationTime(now + 3600);

  return jwt.sign(material.privateKey);
}

/** Builds an unsigned token, as an `alg: none` downgrade attempt would. */
export function buildUnsignedToken(claims: Record<string, unknown>, algorithm = 'none'): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  return `${encode({ alg: algorithm, typ: 'JWT', kid: TEST_KID })}.${encode(claims)}.`;
}

/**
 * Stubs Google's x509 endpoint. Any other fetch target throws, which guarantees
 * a test can never accidentally reach the real Google endpoint.
 */
export function stubCertificateEndpoint(
  certificatePem: string,
  options: { kid?: string; maxAge?: number } = {}
): (input: RequestInfo | URL) => Promise<Response> {
  const kid = options.kid ?? TEST_KID;

  return async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (!url.includes('googleapis.com/robot/v1/metadata/x509')) {
      throw new Error(`Unexpected network call in test: ${url}`);
    }

    return new Response(JSON.stringify({ [kid]: certificatePem }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': `public, max-age=${options.maxAge ?? 3600}`,
      },
    });
  };
}
