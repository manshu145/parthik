import { beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { AuthenticationError, ConfigurationError } from '@/lib/errors';
import { resetEnvCacheForTests } from '@/lib/config/env';
import {
  canIssueSessions,
  hashSessionSecret,
  hashesMatch,
  issueSessionToken,
  readSessionClaimsForRouting,
  verifySessionToken,
} from '@/lib/auth/session-token';

/**
 * Session cookie signing and verification.
 *
 * The cookie is what the middleware gate trusts to decide whether a visitor may reach
 * a privileged surface, so a bug here is an authorization bypass. Treated the same way
 * as the Firebase verifier: every check gets a NEGATIVE test, because a test that only
 * proves the happy path proves nothing about a security boundary.
 */

const SECRET = 'unit-test-secret-that-is-long-enough-to-pass';
const OTHER_SECRET = 'a-completely-different-secret-of-sufficient-length';

const BASE = {
  userId: 'user-1',
  sessionId: 'session-1',
  roles: ['CUSTOMER'],
  surface: 'customer',
  lifetimeSeconds: 3600,
};

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
  resetEnvCacheForTests();
});

describe('issueSessionToken', () => {
  it('round-trips the routing claims', async () => {
    const issued = await issueSessionToken({
      ...BASE,
      roles: ['CUSTOMER', 'SUPER_ADMIN'],
      surface: 'admin',
    });
    const verified = await verifySessionToken(issued.cookieValue);

    expect(verified.userId).toBe('user-1');
    expect(verified.sessionId).toBe('session-1');
    expect(verified.roles).toEqual(['CUSTOMER', 'SUPER_ADMIN']);
    expect(verified.surface).toBe('admin');
  });

  it('returns a token hash that matches the secret inside the cookie', async () => {
    const issued = await issueSessionToken(BASE);
    const verified = await verifySessionToken(issued.cookieValue);

    // The row stores the hash and the cookie carries the secret; if these ever
    // diverged, every session would be issued and then immediately unresolvable.
    expect(verified.tokenHash).toBe(issued.tokenHash);
  });

  it('never puts the raw session secret in the returned hash', async () => {
    const issued = await issueSessionToken(BASE);

    expect(issued.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.cookieValue).not.toContain(issued.tokenHash);
  });

  it('issues a different secret every time, so two sessions never collide', async () => {
    const [a, b] = await Promise.all([issueSessionToken(BASE), issueSessionToken(BASE)]);

    // Identical inputs must still produce distinct sessions — otherwise signing out
    // one device would invalidate another, and `sessions.token_hash` is UNIQUE so the
    // second insert would fail outright.
    expect(a.tokenHash).not.toBe(b.tokenHash);
    expect(a.cookieValue).not.toBe(b.cookieValue);
  });

  it('sets the expiry from the supplied lifetime', async () => {
    const issued = await issueSessionToken({ ...BASE, lifetimeSeconds: 8 * 60 * 60 });
    const seconds = (issued.expiresAt.getTime() - Date.now()) / 1000;

    expect(seconds).toBeGreaterThan(8 * 60 * 60 - 30);
    expect(seconds).toBeLessThanOrEqual(8 * 60 * 60);
  });
});

describe('verifySessionToken — rejections', () => {
  it('rejects an empty cookie', async () => {
    await expect(verifySessionToken('')).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects a garbage cookie', async () => {
    await expect(verifySessionToken('not-a-jwt')).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects a tampered signature', async () => {
    const issued = await issueSessionToken(BASE);
    const tampered = `${issued.cookieValue.slice(0, -4)}AAAA`;

    await expect(verifySessionToken(tampered)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects an edited payload', async () => {
    // The whole point of signing: a user cannot promote themselves by editing claims.
    const issued = await issueSessionToken(BASE);
    const [header, payload, signature] = issued.cookieValue.split('.');
    const decoded = JSON.parse(Buffer.from(payload as string, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    decoded.roles = ['SUPER_ADMIN'];
    const forged = Buffer.from(JSON.stringify(decoded)).toString('base64url');

    await expect(verifySessionToken(`${header}.${forged}.${signature}`)).rejects.toBeInstanceOf(
      AuthenticationError
    );
  });

  it('rejects a cookie signed with a different secret', async () => {
    const issued = await issueSessionToken(BASE);

    process.env.AUTH_SECRET = OTHER_SECRET;
    resetEnvCacheForTests();

    // Also the behaviour on secret ROTATION: old cookies stop verifying, which is the
    // intended effect of rotating.
    await expect(verifySessionToken(issued.cookieValue)).rejects.toBeInstanceOf(
      AuthenticationError
    );
  });

  it('reports an expired cookie as SESSION_EXPIRED, not a generic failure', async () => {
    const issued = await issueSessionToken({ ...BASE, lifetimeSeconds: -60 });

    // The distinction drives UX: "sign in again" versus "something went wrong".
    await expect(verifySessionToken(issued.cookieValue)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('rejects an HMAC token with the wrong audience', async () => {
    const cookie = await signWith({ aud: 'parthik:other', iss: 'parthik' });

    await expect(verifySessionToken(cookie)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects an HMAC token with the wrong issuer', async () => {
    const cookie = await signWith({ aud: 'parthik:session', iss: 'somebody-else' });

    await expect(verifySessionToken(cookie)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects alg: none', async () => {
    // Classic JWT downgrade. `algorithms: ['HS256']` is pinned to prevent it.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'user-1',
        sid: 'session-1',
        roles: ['SUPER_ADMIN'],
        tok: 'x',
        aud_surface: 'admin',
        aud: 'parthik:session',
        iss: 'parthik',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url');

    await expect(verifySessionToken(`${header}.${payload}.`)).rejects.toBeInstanceOf(
      AuthenticationError
    );
  });

  it.each([
    ['sub', { sid: 's', tok: 't', aud_surface: 'admin' }],
    ['sid', { sub: 'u', tok: 't', aud_surface: 'admin' }],
    ['tok', { sub: 'u', sid: 's', aud_surface: 'admin' }],
    ['aud_surface', { sub: 'u', sid: 's', tok: 't' }],
  ])('rejects a correctly signed token missing %s', async (_name, claims) => {
    // Signature-valid but malformed must be refused outright rather than partially
    // trusted — the alternative is an undefined user id reaching a query.
    const cookie = await signWith({ aud: 'parthik:session', iss: 'parthik', ...claims });

    await expect(verifySessionToken(cookie)).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe('configuration', () => {
  it('reports whether sessions can be issued', () => {
    expect(canIssueSessions()).toBe(true);

    delete process.env.AUTH_SECRET;
    resetEnvCacheForTests();

    expect(canIssueSessions()).toBe(false);
  });

  it('throws a typed ConfigurationError when AUTH_SECRET is absent', async () => {
    delete process.env.AUTH_SECRET;
    resetEnvCacheForTests();

    // A 503 naming the problem, never a silent fallback to a guessable key.
    await expect(issueSessionToken(BASE)).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('accepts an explicit secret override, as middleware supplies', async () => {
    const issued = await issueSessionToken(BASE);

    delete process.env.AUTH_SECRET;
    resetEnvCacheForTests();

    // Middleware runs on the edge and passes the secret in rather than parsing the
    // whole environment on every navigation.
    const verified = await verifySessionToken(issued.cookieValue, SECRET);
    expect(verified.userId).toBe('user-1');
  });
});

describe('readSessionClaimsForRouting', () => {
  it('returns claims for a valid cookie', async () => {
    const issued = await issueSessionToken({ ...BASE, roles: ['DRIVER'], surface: 'driver' });
    const claims = await readSessionClaimsForRouting(issued.cookieValue);

    expect(claims).toMatchObject({ userId: 'user-1', roles: ['DRIVER'], surface: 'driver' });
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['garbage', 'nonsense'],
  ])('returns null rather than throwing for a %s cookie', async (_label, value) => {
    // Middleware's only sensible response to a bad cookie is a redirect, so this must
    // never throw — an exception at the edge would be a 500 on every navigation.
    await expect(readSessionClaimsForRouting(value)).resolves.toBeNull();
  });

  it('returns null for an expired cookie', async () => {
    const issued = await issueSessionToken({ ...BASE, lifetimeSeconds: -10 });

    await expect(readSessionClaimsForRouting(issued.cookieValue)).resolves.toBeNull();
  });
});

describe('hashing helpers', () => {
  it('hashes deterministically', async () => {
    await expect(hashSessionSecret('abc')).resolves.toBe(await hashSessionSecret('abc'));
  });

  it('produces different hashes for different inputs', async () => {
    expect(await hashSessionSecret('abc')).not.toBe(await hashSessionSecret('abd'));
  });

  it('compares equal hashes as matching', () => {
    expect(hashesMatch('a'.repeat(64), 'a'.repeat(64))).toBe(true);
  });

  it.each([
    ['a different value', 'a'.repeat(64), 'b'.repeat(64)],
    ['a different length', 'a'.repeat(64), 'a'.repeat(63)],
    ['an empty comparison', 'a'.repeat(64), ''],
  ])('rejects %s', (_label, a, b) => {
    expect(hashesMatch(a, b)).toBe(false);
  });
});

/** Signs an arbitrary claim set with the real secret, to test claim validation. */
async function signWith(claims: Record<string, unknown>): Promise<string> {
  const { aud, iss, ...rest } = claims;

  return new SignJWT({ ...rest })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(String(iss))
    .setAudience(String(aud))
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(new TextEncoder().encode(SECRET));
}
