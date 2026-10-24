import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/config/env';
import { isDevAuthEnabled } from '@/lib/http/preview-access';
import { classifySurface, requiresSession } from '@/lib/http/route-access';

/**
 * The development sign-in switch.
 *
 * REPLACES a former `isUnauthenticatedPreview()` bypass which, outside production,
 * disabled the route gate entirely and left all 83 vendor, driver and admin routes
 * reachable by anonymous visitors. This file previously asserted that bypass was
 * OPEN; it now asserts the opposite, because privileged routes are gated in every
 * environment.
 *
 * What is left is an opt-in that mints a session for a seeded demo user. It is tested
 * from both sides: it must be usable when deliberately enabled, and closed otherwise
 * — including when someone simply forgets to set it.
 */

const KEYS = ['APP_ENV', 'FIREBASE_PROJECT_ID', 'DEV_AUTH_ENABLED'] as const;
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

describe('closed by default', () => {
  it.each(['development', 'preview', 'staging'])(
    'is closed in %s when the opt-in is absent',
    (appEnv) => {
      // The important case. The previous bypass was open in exactly these
      // environments; forgetting to configure something must now DENY, not allow.
      process.env.APP_ENV = appEnv;

      expect(isDevAuthEnabled()).toBe(false);
    }
  );

  it('is closed when APP_ENV is unset and defaults to development', () => {
    expect(isDevAuthEnabled()).toBe(false);
  });

  it('is closed when the opt-in is explicitly false', () => {
    process.env.APP_ENV = 'development';
    process.env.DEV_AUTH_ENABLED = 'false';

    expect(isDevAuthEnabled()).toBe(false);
  });

  it('no longer depends on whether Firebase is configured', () => {
    // The old switch keyed off a MISSING Firebase project, which coupled "auth is
    // unconfigured" to "authorization is disabled" — two things that should never
    // have been the same condition.
    process.env.APP_ENV = 'development';
    process.env.FIREBASE_PROJECT_ID = 'parthik-dev';

    expect(isDevAuthEnabled()).toBe(false);

    delete process.env.FIREBASE_PROJECT_ID;
    resetEnvCacheForTests();

    expect(isDevAuthEnabled()).toBe(false);
  });
});

describe('open only when deliberately enabled', () => {
  it.each(['development', 'preview', 'staging'])('is open in %s with the opt-in', (appEnv) => {
    process.env.APP_ENV = appEnv;
    process.env.DEV_AUTH_ENABLED = 'true';

    expect(isDevAuthEnabled()).toBe(true);
  });
});

describe('production is unconditional', () => {
  it('is closed in production even with the opt-in set', () => {
    // Order matters inside the predicate: production is checked first, so no future
    // change to the opt-in can enable this against real users.
    process.env.APP_ENV = 'production';
    process.env.DEV_AUTH_ENABLED = 'true';

    expect(isDevAuthEnabled()).toBe(false);
  });

  it('is closed in production without the opt-in', () => {
    process.env.APP_ENV = 'production';

    expect(isDevAuthEnabled()).toBe(false);
  });
});

describe('every privileged surface is gated regardless', () => {
  const DASHBOARDS = ['/vendor', '/driver/active', '/admin/orders', '/hi/admin'];
  const CUSTOMER = ['/account', '/checkout', '/favorites', '/hi/account/addresses'];
  const PUBLIC = ['/', '/hi', '/products/toor-dal', '/categories', '/offers', '/login'];

  it.each([...DASHBOARDS, ...CUSTOMER])('%s requires a session', (pathname) => {
    // Asserted independently of any environment variable, which is the whole point:
    // there is no longer a configuration in which these routes are ungated.
    expect(requiresSession(pathname)).toBe(true);
  });

  it.each(PUBLIC)('%s stays public', (pathname) => {
    expect(requiresSession(pathname)).toBe(false);
  });

  it.each(DASHBOARDS)('%s still requires a session with dev auth enabled', (pathname) => {
    process.env.APP_ENV = 'development';
    process.env.DEV_AUTH_ENABLED = 'true';

    // Dev auth grants a SESSION; it does not remove the gate. The distinction is the
    // security improvement over the previous bypass.
    expect(requiresSession(pathname)).toBe(true);
  });

  it('classifies the surfaces the gate depends on', () => {
    expect(classifySurface('/vendor/orders')).toBe('vendor');
    expect(classifySurface('/hi/driver/cash')).toBe('driver');
    expect(classifySurface('/admin/settings/payments')).toBe('admin');
    expect(classifySurface('/account')).toBe('customer');
    expect(classifySurface('/products/toor-dal')).toBe('public');
  });
});
