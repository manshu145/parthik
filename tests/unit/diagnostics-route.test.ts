import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Development diagnostics route tests.
 *
 * Two security claims are asserted here rather than trusted:
 *
 *   1. The endpoint is INVISIBLE in production (404, not 403 — a 403 would confirm
 *      it exists).
 *   2. It never exposes key material, only booleans and provider names.
 *
 * The route handler is invoked directly, so no server is needed.
 */

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

async function loadRoute(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  vi.resetModules();
  return import('@/app/api/v1/diagnostics/providers/route');
}

const REQUEST = () => new Request('http://localhost/api/v1/diagnostics/providers');

describe('production', () => {
  it('returns 404 so the endpoint is not discoverable', async () => {
    const { GET } = await loadRoute({
      APP_ENV: 'production',
      MAPS_PROVIDER: 'auto',
      GOOGLE_MAPS_SERVER_KEY: 'production-key-value',
    });

    const response = await GET(REQUEST());

    expect(response.status).toBe(404);
  });

  it('returns no body in production', async () => {
    const { GET } = await loadRoute({
      APP_ENV: 'production',
      GOOGLE_MAPS_SERVER_KEY: 'production-key-value',
    });

    const response = await GET(REQUEST());

    expect(await response.text()).toBe('');
  });

  it('returns 404 even when a mock provider is misconfigured in production', async () => {
    // The diagnostics surface must not become the way someone discovers this.
    const { GET } = await loadRoute({
      APP_ENV: 'production',
      MAPS_PROVIDER: 'mock',
      GOOGLE_MAPS_SERVER_KEY: undefined,
    });

    expect((await GET(REQUEST())).status).toBe(404);
  });
});

describe('development', () => {
  it('reports the active maps provider', async () => {
    const { GET } = await loadRoute({
      APP_ENV: 'development',
      MAPS_PROVIDER: 'auto',
      GOOGLE_MAPS_SERVER_KEY: undefined,
    });

    const response = await GET(REQUEST());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.maps.active).toBe('mock');
    expect(body.data.maps.usingMockFallback).toBe(true);
    expect(body.data.maps.serverKeyPresent).toBe(false);
  });

  it('lists mock fixtures so the serviceable pincodes are discoverable', async () => {
    const { GET } = await loadRoute({
      APP_ENV: 'development',
      MAPS_PROVIDER: 'mock',
      GOOGLE_MAPS_SERVER_KEY: undefined,
    });

    const body = await (await GET(REQUEST())).json();

    expect(Array.isArray(body.data.maps.fixtures)).toBe(true);
    expect(body.data.location.serviceablePincodes).toContain('452001');
  });

  it('reports the location backend', async () => {
    const { GET } = await loadRoute({
      APP_ENV: 'development',
      DATABASE_URL: undefined,
    });

    const body = await (await GET(REQUEST())).json();

    expect(body.data.location.backend).toBe('memory');
    expect(body.data.location.databaseConfigured).toBe(false);
  });

  it('NEVER includes key material, only whether a key is present', async () => {
    const { GET } = await loadRoute({
      APP_ENV: 'development',
      MAPS_PROVIDER: 'auto',
      GOOGLE_MAPS_SERVER_KEY: 'AIzaSyTOTALLY-FAKE-KEY-FOR-TESTS',
    });

    const text = await (await GET(REQUEST())).text();

    // The key value, any prefix of it, and the connection string must all be absent.
    expect(text).not.toContain('AIzaSyTOTALLY-FAKE-KEY-FOR-TESTS');
    expect(text).not.toContain('AIza');
    // The boolean is what is useful, and it is safe.
    expect(JSON.parse(text).data.maps.serverKeyPresent).toBe(true);
  });

  it('does not leak the database connection string', async () => {
    const { GET } = await loadRoute({
      APP_ENV: 'development',
      DATABASE_URL: 'postgres://user:secretpassword@db.example.com:5432/parthik',
    });

    const text = await (await GET(REQUEST())).text();

    expect(text).not.toContain('secretpassword');
    expect(text).not.toContain('db.example.com');
    expect(JSON.parse(text).data.location.databaseConfigured).toBe(true);
  });
});
