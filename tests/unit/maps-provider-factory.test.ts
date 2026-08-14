import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Maps provider selection tests.
 *
 * The rule under test is the one with real consequences: **the mock must never be
 * selected implicitly in production.** A mock quietly serving live customers would
 * return invented addresses and delivery fees, which is far worse than an outage.
 *
 * Environment validation is cached per module instance, so each case re-imports the
 * factory with `vi.resetModules()` after setting the environment.
 */

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

/** Loads the factory fresh under a given environment. */
async function loadFactory(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  vi.resetModules();
  return import('@/lib/maps/provider-factory');
}

/**
 * Loads the factory together with the logger instance it will actually use.
 *
 * `vi.resetModules()` creates a fresh module registry, so a logger imported before
 * the reset is a DIFFERENT object from the one the factory sees and a spy on it
 * would never fire. Both must be imported after the reset.
 */
async function loadFactoryWithLogger(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  vi.resetModules();
  const { logger } = await import('@/lib/logger');
  const factory = await import('@/lib/maps/provider-factory');

  return { ...factory, logger };
}

describe('MAPS_PROVIDER=auto', () => {
  it('selects the mock in development when no server key is present', async () => {
    const { resolveMapsProvider } = await loadFactory({
      APP_ENV: 'development',
      MAPS_PROVIDER: 'auto',
      GOOGLE_MAPS_SERVER_KEY: undefined,
    });

    const resolved = resolveMapsProvider();

    expect(resolved.name).toBe('mock');
    expect(resolved.isFallback).toBe(true);
  });

  it('selects Google when a server key is present', async () => {
    const { resolveMapsProvider } = await loadFactory({
      APP_ENV: 'development',
      MAPS_PROVIDER: 'auto',
      GOOGLE_MAPS_SERVER_KEY: 'test-key-not-real',
    });

    const resolved = resolveMapsProvider();

    expect(resolved.name).toBe('google');
    expect(resolved.isFallback).toBe(false);
  });

  it('selects the mock in preview when no server key is present', async () => {
    // Preview deployments must come up with zero credentials, same as CI.
    const { resolveMapsProvider } = await loadFactory({
      APP_ENV: 'preview',
      MAPS_PROVIDER: 'auto',
      GOOGLE_MAPS_SERVER_KEY: undefined,
    });

    expect(resolveMapsProvider().name).toBe('mock');
  });

  it('NEVER selects the mock in production, even with no key', async () => {
    const { resolveMapsProvider } = await loadFactory({
      APP_ENV: 'production',
      MAPS_PROVIDER: 'auto',
      GOOGLE_MAPS_SERVER_KEY: undefined,
    });

    const resolved = resolveMapsProvider();

    // The Google adapter is returned so the missing key surfaces as a typed 503
    // rather than as fabricated data.
    expect(resolved.name).toBe('google');
    expect(resolved.isFallback).toBe(false);
  });

  it('logs an error when production has no key', async () => {
    const { resolveMapsProvider, logger } = await loadFactoryWithLogger({
      APP_ENV: 'production',
      MAPS_PROVIDER: 'auto',
      GOOGLE_MAPS_SERVER_KEY: undefined,
    });

    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    resolveMapsProvider();

    // Silence here would let a misconfigured production deploy look healthy.
    expect(spy).toHaveBeenCalled();
  });
});

describe('MAPS_PROVIDER=mock', () => {
  it('selects the mock in development', async () => {
    const { resolveMapsProvider } = await loadFactory({
      APP_ENV: 'development',
      MAPS_PROVIDER: 'mock',
      GOOGLE_MAPS_SERVER_KEY: undefined,
    });

    const resolved = resolveMapsProvider();

    expect(resolved.name).toBe('mock');
    // Explicitly requested, so not a fallback.
    expect(resolved.isFallback).toBe(false);
  });

  it('selects the mock even when a real key is available', async () => {
    // Useful for deterministic local testing without touching billing.
    const { resolveMapsProvider } = await loadFactory({
      APP_ENV: 'development',
      MAPS_PROVIDER: 'mock',
      GOOGLE_MAPS_SERVER_KEY: 'test-key-not-real',
    });

    expect(resolveMapsProvider().name).toBe('mock');
  });

  it('logs an error if explicitly set in production', async () => {
    const { resolveMapsProvider, logger } = await loadFactoryWithLogger({
      APP_ENV: 'production',
      MAPS_PROVIDER: 'mock',
      GOOGLE_MAPS_SERVER_KEY: undefined,
    });

    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    resolveMapsProvider();

    expect(spy).toHaveBeenCalled();
  });
});

describe('MAPS_PROVIDER=google', () => {
  it('selects Google even when no key is configured', async () => {
    // The adapter raises ConfigurationError on use. Pre-empting that here would
    // hide an explicit misconfiguration behind a silent mock.
    const { resolveMapsProvider } = await loadFactory({
      APP_ENV: 'development',
      MAPS_PROVIDER: 'google',
      GOOGLE_MAPS_SERVER_KEY: undefined,
    });

    const resolved = resolveMapsProvider();

    expect(resolved.name).toBe('google');
    expect(resolved.isFallback).toBe(false);
  });
});

describe('MAPS_PROVIDER validation', () => {
  it('rejects an unrecognised value at startup', async () => {
    // A typo such as MAPS_PROVIDER=mocks must fail loudly, not fall through to a
    // default and leave someone puzzled about which provider is live.
    await expect(
      loadFactory({
        APP_ENV: 'development',
        MAPS_PROVIDER: 'mocks',
        GOOGLE_MAPS_SERVER_KEY: undefined,
      }).then((module) => module.resolveMapsProvider())
    ).rejects.toThrow();
  });

  it('defaults to auto when unset', async () => {
    const { resolveMapsProvider } = await loadFactory({
      APP_ENV: 'development',
      MAPS_PROVIDER: undefined,
      GOOGLE_MAPS_SERVER_KEY: undefined,
    });

    expect(resolveMapsProvider().name).toBe('mock');
  });
});

describe('getMapsProvider', () => {
  it('returns a provider satisfying the full MapsProvider contract', async () => {
    const { getMapsProvider } = await loadFactory({
      APP_ENV: 'development',
      MAPS_PROVIDER: 'mock',
      GOOGLE_MAPS_SERVER_KEY: undefined,
    });

    const provider = getMapsProvider();

    // Every method the business modules depend on must exist regardless of which
    // implementation was selected.
    for (const method of [
      'autocomplete',
      'getPlaceDetails',
      'reverseGeocode',
      'geocodePincode',
      'estimateRoute',
      'routeMatrix',
      'isConfigured',
    ] as const) {
      expect(typeof provider[method]).toBe('function');
    }
  });
});
