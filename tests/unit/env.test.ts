import { beforeEach, describe, expect, it } from 'vitest';
import { getClientEnv, getServerEnv, resetEnvCacheForTests } from '@/lib/config/env';

/**
 * Configuration is validated once at a single boundary and the app refuses to
 * start on invalid REQUIRED values (docs/ARCHITECTURE.md §15).
 */

// Environment isolation and restoration is handled centrally by
// tests/unit/setup.ts, which resets process.env to a known baseline before every
// test. Individual cases only need to set what they are asserting on.
beforeEach(() => {
  resetEnvCacheForTests();
});

describe('server environment', () => {
  it('applies documented defaults when optional values are absent', () => {
    delete process.env.APP_ENV;
    delete process.env.LOG_LEVEL;
    delete process.env.PUBLIC_APP_URL;
    resetEnvCacheForTests();

    const env = getServerEnv();
    expect(env.APP_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.PUBLIC_APP_URL).toBe('http://localhost:3000');
  });

  it('boots with no provider credentials at all', () => {
    // The foundation must be usable without third-party credentials.
    for (const key of Object.keys(process.env)) {
      if (/^(FIREBASE|GOOGLE|GA4|GCP|CACHE|DATABASE)/.test(key)) delete process.env[key];
    }
    resetEnvCacheForTests();

    expect(() => getServerEnv()).not.toThrow();
    expect(getServerEnv().DATABASE_URL).toBeUndefined();
  });

  it('rejects an invalid APP_ENV rather than guessing', () => {
    process.env.APP_ENV = 'prod';
    resetEnvCacheForTests();

    expect(() => getServerEnv()).toThrow(/APP_ENV/);
  });

  it('rejects a malformed DATABASE_URL', () => {
    process.env.DATABASE_URL = 'not-a-url';
    resetEnvCacheForTests();

    expect(() => getServerEnv()).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'verbose';
    resetEnvCacheForTests();

    expect(() => getServerEnv()).toThrow(/LOG_LEVEL/);
  });

  it('rejects a service-account key that is not a PEM private key', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY = 'just-a-string';
    resetEnvCacheForTests();

    expect(() => getServerEnv()).toThrow(/PEM/);
  });

  it('points the developer at .env.example on failure', () => {
    process.env.APP_ENV = 'nonsense';
    resetEnvCacheForTests();

    expect(() => getServerEnv()).toThrow(/\.env\.example/);
  });

  it('memoises after a successful parse', () => {
    expect(getServerEnv()).toBe(getServerEnv());
  });
});

describe('client environment', () => {
  it('never throws when optional public values are absent', () => {
    expect(() => getClientEnv()).not.toThrow();
  });

  it('rejects a malformed public app url', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'localhost';
    resetEnvCacheForTests();

    expect(() => getClientEnv()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
