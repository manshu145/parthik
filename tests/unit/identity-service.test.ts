import { beforeEach, describe, expect, it } from 'vitest';
import { AuthenticationError, AuthorizationError, RateLimitError } from '@/lib/errors';
import { resetEnvCacheForTests } from '@/lib/config/env';
import { ADMIN_IDLE_TIMEOUT_SECONDS, SESSION_LIFETIMES_SECONDS } from '@/lib/auth/session-cookie';
import { IdentityService } from '@/modules/identity/identity.service';
import {
  DEMO_VENDOR_SCOPE_ID,
  InMemoryIdentityRepository,
} from '@/modules/identity/identity-memory.repository';
import { demoPersona } from '@/modules/identity/demo-personas';
import { can } from '@/modules/identity/identity.policy';

/**
 * The Firebase→Parthik boundary (docs/ARCHITECTURE.md §11.1).
 *
 * Uses the Auth Emulator token shape, which the verifier accepts only when
 * FIREBASE_AUTH_EMULATOR_HOST is set outside production. That keeps these tests
 * deterministic and free: no signing keys to manage, no billable calls, and no reliance
 * on Google's live certificate endpoint (docs/ARCHITECTURE.md §13.1).
 *
 * Each test builds an ISOLATED repository. The application shares one store on
 * globalThis, which is correct there and would leak state between cases here.
 */

const PROJECT_ID = 'parthik-test';
const SECRET = 'identity-service-test-secret-long-enough';

const FINGERPRINT = { ipHash: 'ip-hash-1', userAgent: 'vitest' };

const CUSTOMER = demoPersona('customer');
const ADMIN = demoPersona('admin');
const VENDOR = demoPersona('vendor');
const SUPPORT = demoPersona('support');

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** An unsigned, emulator-shaped ID token. */
function emulatorToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);

  return [
    base64url({ alg: 'none', typ: 'JWT' }),
    base64url({
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      aud: PROJECT_ID,
      sub: CUSTOMER.firebaseUid,
      iat: now,
      exp: now + 3600,
      auth_time: now,
      phone_number: '+919000000001',
      firebase: { sign_in_provider: 'phone' },
      ...overrides,
    }),
    '',
  ].join('.');
}

function makeService() {
  const repository = new InMemoryIdentityRepository({ isolated: true });
  return { repository, service: new IdentityService({ repository }) };
}

beforeEach(() => {
  process.env.APP_ENV = 'development';
  process.env.AUTH_SECRET = SECRET;
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  resetEnvCacheForTests();
});

describe('exchangeFirebaseToken — success', () => {
  it('issues a session for a seeded user', async () => {
    const { service } = makeService();

    const result = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });

    expect(result.isNewUser).toBe(false);
    expect(result.audience).toBe('customer');
    expect(result.landingPath).toBe('/');
    expect(result.token.cookieValue).toBeTruthy();
  });

  it('takes identity from the TOKEN, never from the caller', async () => {
    const { service, repository } = makeService();

    // The request body carries no phone/uid by schema; this proves the service reads the
    // verified claims even when a different number is seeded against that uid.
    await service.exchangeFirebaseToken({
      idToken: emulatorToken({ sub: CUSTOMER.firebaseUid, phone_number: '+919111122223' }),
      fingerprint: FINGERPRINT,
    });

    const user = await repository.findUserByFirebaseUid(CUSTOMER.firebaseUid);
    expect(user?.phone).toBe('+919111122223');
  });

  it('creates a first-time user with CUSTOMER only', async () => {
    const { service } = makeService();

    const result = await service.exchangeFirebaseToken({
      idToken: emulatorToken({ sub: 'brand-new-uid', phone_number: '+919555566667' }),
      fingerprint: FINGERPRINT,
    });

    // Elevated roles are always granted deliberately by an admin, never inferred at
    // sign-up.
    expect(result.isNewUser).toBe(true);
    expect(result.actor.roles.map((grant) => grant.roleKey)).toEqual(['CUSTOMER']);
    expect(can(result.actor, 'dashboard:view')).toBe(false);
  });

  it('applies the requested locale only to a NEW user', async () => {
    const { service, repository } = makeService();

    await service.exchangeFirebaseToken({
      idToken: emulatorToken({ sub: 'hi-user-uid', phone_number: '+919777788889' }),
      locale: 'hi',
      fingerprint: FINGERPRINT,
    });
    expect((await repository.findUserByFirebaseUid('hi-user-uid'))?.preferredLocale).toBe('hi');

    // Signing in from another device must not overwrite a stored preference.
    await service.exchangeFirebaseToken({
      idToken: emulatorToken({ sub: 'hi-user-uid', phone_number: '+919777788889' }),
      locale: 'en',
      fingerprint: FINGERPRINT,
    });
    expect((await repository.findUserByFirebaseUid('hi-user-uid'))?.preferredLocale).toBe('hi');
  });

  it('gives an admin the 8-hour band and the admin landing path', async () => {
    const { service } = makeService();

    const result = await service.exchangeFirebaseToken({
      idToken: emulatorToken({ sub: ADMIN.firebaseUid, phone_number: ADMIN.phone }),
      fingerprint: FINGERPRINT,
    });

    expect(result.audience).toBe('admin');
    expect(result.landingPath).toBe('/admin');
    const lifetime = (result.token.expiresAt.getTime() - Date.now()) / 1000;
    expect(lifetime).toBeLessThanOrEqual(SESSION_LIFETIMES_SECONDS.admin);
  });

  it('carries a vendor scope through to the actor', async () => {
    const { service } = makeService();

    const result = await service.exchangeFirebaseToken({
      idToken: emulatorToken({ sub: VENDOR.firebaseUid, phone_number: VENDOR.phone }),
      fingerprint: FINGERPRINT,
    });

    expect(can(result.actor, 'product:publish', { vendorId: DEMO_VENDOR_SCOPE_ID })).toBe(true);
    expect(can(result.actor, 'product:publish', { vendorId: 'someone-else' })).toBe(false);
  });

  it('stamps last_login_at', async () => {
    const { service, repository } = makeService();

    await service.exchangeFirebaseToken({ idToken: emulatorToken(), fingerprint: FINGERPRINT });

    const user = await repository.findUserByFirebaseUid(CUSTOMER.firebaseUid);
    expect(user?.lastLoginAt).toBeInstanceOf(Date);
  });
});

describe('exchangeFirebaseToken — rejections', () => {
  it.each([
    ['a token for another Firebase project', { aud: 'other-project' }],
    ['a wrong issuer', { iss: 'https://securetoken.google.com/other' }],
    ['a non-phone provider', { firebase: { sign_in_provider: 'google.com' } }],
    ['a missing phone claim', { phone_number: undefined }],
    ['a missing subject', { sub: undefined }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 120 }],
  ])('rejects %s', async (_label, overrides) => {
    const { service } = makeService();

    await expect(
      service.exchangeFirebaseToken({
        idToken: emulatorToken(overrides),
        fingerprint: FINGERPRINT,
      })
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('records a failed attempt against the IP, with no identifier', async () => {
    const { service, repository } = makeService();

    await expect(
      service.exchangeFirebaseToken({
        idToken: 'garbage',
        fingerprint: FINGERPRINT,
      })
    ).rejects.toBeInstanceOf(AuthenticationError);

    // A rejected token yields no identity we are entitled to believe, so the only
    // dependable key is the IP (docs/SECURITY.md §2.4).
    expect(await repository.countRecentFailedAttempts('ip-hash-1', new Date(0))).toBe(1);
  });

  it.each(['SUSPENDED', 'BANNED'] as const)('refuses a %s account', async (status) => {
    const { service, repository } = makeService();

    const user = await repository.findUserByFirebaseUid(CUSTOMER.firebaseUid);
    repository.setStatusForTests(user!.id, status);

    await expect(
      service.exchangeFirebaseToken({ idToken: emulatorToken(), fingerprint: FINGERPRINT })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('throttles after too many failures from one IP', async () => {
    const { service, repository } = makeService();
    repository.seedFailedAttemptsForTests('ip-hash-1', 10);

    // Checked BEFORE verification, so a flood costs no crypto work.
    await expect(
      service.exchangeFirebaseToken({ idToken: emulatorToken(), fingerprint: FINGERPRINT })
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('throttles per IP, not globally', async () => {
    const { service, repository } = makeService();
    repository.seedFailedAttemptsForTests('ip-hash-attacker', 20);

    // One abusive client must not lock everyone else out.
    await expect(
      service.exchangeFirebaseToken({
        idToken: emulatorToken(),
        fingerprint: { ipHash: 'ip-hash-innocent', userAgent: 'vitest' },
      })
    ).resolves.toMatchObject({ audience: 'customer' });
  });

  it('still signs in when no IP is available', async () => {
    const { service } = makeService();

    // Behind a proxy that strips the header the limit degrades, but sign-in must not
    // break — reCAPTCHA and the edge limit still apply.
    await expect(
      service.exchangeFirebaseToken({
        idToken: emulatorToken(),
        fingerprint: { ipHash: null, userAgent: null },
      })
    ).resolves.toMatchObject({ audience: 'customer' });
  });
});

describe('resolveSession', () => {
  it('returns null when there is no cookie', async () => {
    const { service } = makeService();
    await expect(service.resolveSession(undefined)).resolves.toBeNull();
  });

  it('resolves a freshly issued session', async () => {
    const { service } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });

    const context = await service.resolveSession(issued.token.cookieValue);

    expect(context?.actor.userId).toBe(issued.actor.userId);
    expect(context?.audience).toBe('customer');
  });

  it('rejects a signature-valid cookie with no matching session row', async () => {
    const { service } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });

    // A different service instance means a different isolated store: the cookie verifies
    // but the session does not exist.
    const other = makeService().service;

    await expect(other.resolveSession(issued.token.cookieValue)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('rejects a revoked session immediately', async () => {
    const { service } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });

    await service.revokeSession({ cookieValue: issued.token.cookieValue, allDevices: false });

    // D-10 requires revocation to take effect at once, not at cookie expiry.
    await expect(service.resolveSession(issued.token.cookieValue)).rejects.toBeInstanceOf(
      AuthenticationError
    );
  });

  it('rejects an expired session row', async () => {
    const { service, repository } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });

    repository.setExpiryForTests(issued.actor.sessionId, new Date(Date.now() - 1000));

    await expect(service.resolveSession(issued.token.cookieValue)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('rejects a session whose user was banned mid-session', async () => {
    const { service, repository } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });

    repository.setStatusForTests(issued.actor.userId, 'BANNED');

    // The reason the session is re-read from the database on every request: the cookie
    // still looks perfectly valid.
    await expect(service.resolveSession(issued.token.cookieValue)).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it('reflects a role granted mid-session without re-signing in', async () => {
    const { service, repository } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });
    expect(can(issued.actor, 'dashboard:view')).toBe(false);

    repository.grantRoleForTests(issued.actor.userId, {
      roleKey: 'ADMIN_SUPPORT',
      scopeType: 'GLOBAL',
      scopeId: null,
    });

    const context = await service.resolveSession(issued.token.cookieValue);
    expect(can(context!.actor, 'dashboard:view')).toBe(true);
  });

  it('re-issues the cookie when roles change, so middleware stops routing on stale claims', async () => {
    const { service, repository } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });

    repository.grantRoleForTests(issued.actor.userId, {
      roleKey: 'ADMIN_SUPPORT',
      scopeType: 'GLOBAL',
      scopeId: null,
    });

    const context = await service.resolveSession(issued.token.cookieValue);

    // Without this a user promoted to admin would never see the admin nav until they
    // signed out and back in.
    expect(context?.renewedCookie).toBeDefined();
    expect(context?.audience).toBe('admin');
  });

  it('does not re-issue the cookie on an ordinary request', async () => {
    const { service } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });

    // A Set-Cookie on every page view would be pure overhead.
    const context = await service.resolveSession(issued.token.cookieValue);
    expect(context?.renewedCookie).toBeUndefined();
  });

  it('resolves with the renewed cookie after a rotation', async () => {
    const { service, repository } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });
    repository.grantRoleForTests(issued.actor.userId, {
      roleKey: 'DRIVER',
      scopeType: 'GLOBAL',
      scopeId: null,
    });

    const first = await service.resolveSession(issued.token.cookieValue);
    const renewed = first!.renewedCookie!.cookieValue;

    // The row must track the new hash, or the refreshed cookie would not resolve.
    await expect(service.resolveSession(renewed)).resolves.toMatchObject({
      actor: { userId: issued.actor.userId },
    });
  });

  it('expires an idle admin session', async () => {
    const { service, repository } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken({ sub: ADMIN.firebaseUid, phone_number: ADMIN.phone }),
      fingerprint: FINGERPRINT,
    });

    repository.setLastSeenForTests(
      issued.actor.sessionId,
      new Date(Date.now() - (ADMIN_IDLE_TIMEOUT_SECONDS + 60) * 1000)
    );

    // Enforced from last_seen_at rather than the cookie, so holding a cookie and
    // replaying it later cannot evade the timeout.
    await expect(service.resolveSession(issued.token.cookieValue)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('does not apply the idle timeout to a customer session', async () => {
    const { service, repository } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });

    repository.setLastSeenForTests(
      issued.actor.sessionId,
      new Date(Date.now() - (ADMIN_IDLE_TIMEOUT_SECONDS + 600) * 1000)
    );

    // Customer sessions are 30-day rolling; an idle timeout there would sign shoppers
    // out constantly.
    await expect(service.resolveSession(issued.token.cookieValue)).resolves.toMatchObject({
      audience: 'customer',
    });
  });

  it('revokes the row when an admin session times out', async () => {
    const { service, repository } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken({ sub: ADMIN.firebaseUid, phone_number: ADMIN.phone }),
      fingerprint: FINGERPRINT,
    });
    repository.setLastSeenForTests(
      issued.actor.sessionId,
      new Date(Date.now() - (ADMIN_IDLE_TIMEOUT_SECONDS + 60) * 1000)
    );

    await expect(service.resolveSession(issued.token.cookieValue)).rejects.toThrow();

    const found = await repository.findSessionByTokenHash(issued.token.tokenHash);
    expect(found?.session.revokedReason).toBe('idle_timeout');
  });
});

describe('revokeSession', () => {
  it('revokes the current session', async () => {
    const { service } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });

    await expect(
      service.revokeSession({ cookieValue: issued.token.cookieValue, allDevices: false })
    ).resolves.toEqual({ revoked: 1 });
  });

  it('revokes every session when allDevices is set', async () => {
    const { service } = makeService();
    const first = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });
    await service.exchangeFirebaseToken({ idToken: emulatorToken(), fingerprint: FINGERPRINT });

    const result = await service.revokeSession({
      cookieValue: first.token.cookieValue,
      allDevices: true,
    });

    expect(result.revoked).toBe(2);
  });

  it('succeeds for an unverifiable cookie', async () => {
    const { service } = makeService();

    // Sign-out must never fail: a user on a shared device who sees an error cannot tell
    // whether they are still signed in.
    await expect(
      service.revokeSession({ cookieValue: 'garbage', allDevices: false })
    ).resolves.toEqual({ revoked: 0 });
  });

  it('succeeds when there is no cookie at all', async () => {
    const { service } = makeService();

    await expect(
      service.revokeSession({ cookieValue: undefined, allDevices: false })
    ).resolves.toEqual({ revoked: 0 });
  });

  it('is idempotent', async () => {
    const { service } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });

    await service.revokeSession({ cookieValue: issued.token.cookieValue, allDevices: false });

    await expect(
      service.revokeSession({ cookieValue: issued.token.cookieValue, allDevices: false })
    ).resolves.toEqual({ revoked: 0 });
  });

  it('preserves the original revocation reason', async () => {
    const { service, repository } = makeService();
    const issued = await service.exchangeFirebaseToken({
      idToken: emulatorToken(),
      fingerprint: FINGERPRINT,
    });

    await service.revokeSession({ cookieValue: issued.token.cookieValue, allDevices: false });
    await service.revokeAllSessions(issued.actor.userId, 'admin_ban');

    const found = await repository.findSessionByTokenHash(issued.token.tokenHash);
    expect(found?.session.revokedReason).toBe('user_logout');
  });
});

describe('createDevelopmentSession', () => {
  it('signs in a seeded persona', async () => {
    const { service } = makeService();

    const result = await service.createDevelopmentSession({
      firebaseUid: SUPPORT.firebaseUid,
      fingerprint: FINGERPRINT,
    });

    expect(result?.audience).toBe('admin');
    expect(can(result!.actor, 'ticket:reply')).toBe(true);
    expect(can(result!.actor, 'refund:manage')).toBe(false);
  });

  it('returns null for an unknown uid instead of creating a user', async () => {
    const { service, repository } = makeService();

    // It must never be usable to conjure an account, only to sign in as a seeded one.
    await expect(
      service.createDevelopmentSession({ firebaseUid: 'not-seeded', fingerprint: FINGERPRINT })
    ).resolves.toBeNull();
    expect(await repository.findUserByFirebaseUid('not-seeded')).toBeNull();
  });

  it('returns null for a suspended persona', async () => {
    const { service, repository } = makeService();
    const user = await repository.findUserByFirebaseUid(ADMIN.firebaseUid);
    repository.setStatusForTests(user!.id, 'SUSPENDED');

    await expect(
      service.createDevelopmentSession({
        firebaseUid: ADMIN.firebaseUid,
        fingerprint: FINGERPRINT,
      })
    ).resolves.toBeNull();
  });

  it('produces a session the normal path can resolve', async () => {
    const { service } = makeService();
    const result = await service.createDevelopmentSession({
      firebaseUid: VENDOR.firebaseUid,
      fingerprint: FINGERPRINT,
    });

    // It shares the real issue-then-insert path, so it exercises the production
    // mechanism rather than a parallel one that could drift.
    await expect(service.resolveSession(result!.token.cookieValue)).resolves.toMatchObject({
      audience: 'vendor',
    });
  });
});

describe('production safety', () => {
  it('refuses an emulator token in production', async () => {
    const { service } = makeService();
    process.env.APP_ENV = 'production';
    resetEnvCacheForTests();

    // The one place an accident would be catastrophic: emulator tokens are UNSIGNED.
    await expect(
      service.exchangeFirebaseToken({ idToken: emulatorToken(), fingerprint: FINGERPRINT })
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
