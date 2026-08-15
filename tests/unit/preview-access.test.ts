import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/config/env';
import { isUnauthenticatedPreview } from '@/lib/http/preview-access';
import { classifySurface } from '@/lib/http/route-access';

/**
 * The dashboard preview switch.
 *
 * This is the one place in the codebase that deliberately serves a gated surface
 * without a session, so it gets tested from both sides: it must be OPEN while auth
 * does not exist, and it must be CLOSED the instant either condition changes.
 *
 * The second half matters more than the first. A preview bypass that survives into
 * production is an authorization hole, so the test asserts that configuring
 * Firebase — or deploying to production — closes it with no code change.
 */

const KEYS = ['APP_ENV', 'FIREBASE_PROJECT_ID'] as const;
const snapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
  resetEnvCacheForTests();
});

afterEach(() => {
  for (const key of KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
  resetEnvCacheForTests();
});

describe('open while authentication does not exist', () => {
  it.each(['development', 'preview', 'staging'])('is open in %s', (appEnv) => {
    process.env.APP_ENV = appEnv;

    expect(isUnauthenticatedPreview()).toBe(true);
  });

  it('is open when APP_ENV is unset and defaults to development', () => {
    expect(isUnauthenticatedPreview()).toBe(true);
  });
});

describe('closes itself', () => {
  it('is closed in production even without Firebase', () => {
    // Order matters: production wins regardless of provider configuration, so a
    // half-configured production deploy is never open.
    process.env.APP_ENV = 'production';

    expect(isUnauthenticatedPreview()).toBe(false);
  });

  it('is closed as soon as Firebase is configured', () => {
    process.env.APP_ENV = 'preview';
    process.env.FIREBASE_PROJECT_ID = 'parthik-preview';

    expect(isUnauthenticatedPreview()).toBe(false);
  });

  it('is closed in production with Firebase configured', () => {
    process.env.APP_ENV = 'production';
    process.env.FIREBASE_PROJECT_ID = 'parthik-prod';

    expect(isUnauthenticatedPreview()).toBe(false);
  });

  it('ignores a blank FIREBASE_PROJECT_ID rather than treating it as configured', () => {
    // An empty string in a deploy config must not be mistaken for real auth; the
    // env schema trims it away, leaving the switch open and the surface honest.
    process.env.APP_ENV = 'preview';
    process.env.FIREBASE_PROJECT_ID = '   ';

    expect(isUnauthenticatedPreview()).toBe(true);
  });
});

describe('agrees with the middleware predicate', () => {
  /**
   * The middleware duplicates this logic because it runs on the edge without the
   * validated config. Duplication is only safe while the two agree, so this
   * reimplements the middleware's surface check and compares the combination.
   */
  function middlewareWouldAllow(pathname: string): boolean {
    if (process.env.APP_ENV === 'production') return false;
    if (process.env.FIREBASE_PROJECT_ID) return false;

    const surface = classifySurface(pathname);
    return surface === 'vendor' || surface === 'driver' || surface === 'admin';
  }

  const DASHBOARDS = ['/vendor', '/driver/active', '/admin/orders', '/hi/admin'];
  const CUSTOMER = ['/account', '/checkout', '/favorites', '/hi/account/addresses'];

  it.each(DASHBOARDS)('allows the dashboard route %s', (pathname) => {
    process.env.APP_ENV = 'preview';

    expect(middlewareWouldAllow(pathname)).toBe(isUnauthenticatedPreview());
    expect(middlewareWouldAllow(pathname)).toBe(true);
  });

  it.each(CUSTOMER)('still gates the customer route %s', (pathname) => {
    // The banner-bearing shell is fine for a dashboard; an empty `/account` would
    // just look broken, so those keep redirecting to login.
    process.env.APP_ENV = 'preview';

    expect(middlewareWouldAllow(pathname)).toBe(false);
  });

  it.each(DASHBOARDS)('gates %s in production', (pathname) => {
    process.env.APP_ENV = 'production';

    expect(middlewareWouldAllow(pathname)).toBe(false);
    expect(isUnauthenticatedPreview()).toBe(false);
  });

  it.each(DASHBOARDS)('gates %s once Firebase exists', (pathname) => {
    process.env.APP_ENV = 'preview';
    process.env.FIREBASE_PROJECT_ID = 'parthik-preview';

    expect(middlewareWouldAllow(pathname)).toBe(false);
    expect(isUnauthenticatedPreview()).toBe(false);
  });
});
