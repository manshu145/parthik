import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/config/env';

/**
 * SEO surfaces (master spec §20, docs/ROUTES.md §11).
 *
 * These are asserted as unit tests because the interesting behaviour is
 * environment-dependent: a preview deployment must never be indexable, while
 * production must expose a precise allow/disallow set. Verifying that against a
 * running server would need two builds.
 */

async function loadRobots() {
  // Reset the module registry so module-level env reads are re-evaluated.
  vi.resetModules();
  const robotsModule = await import('@/app/robots');
  return robotsModule.default as () => {
    rules: Array<{ userAgent: string; allow?: string; disallow?: string | string[] }>;
    sitemap?: string;
  };
}

async function loadSitemap() {
  vi.resetModules();
  const sitemapModule = await import('@/app/sitemap');
  return sitemapModule.default as () => Array<{
    url: string;
    alternates?: { languages?: Record<string, string> };
  }>;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://parthik.com';
  resetEnvCacheForTests();
});

describe('robots.txt', () => {
  it('disallows everything outside production', async () => {
    for (const appEnv of ['development', 'preview', 'staging']) {
      process.env.APP_ENV = appEnv;
      resetEnvCacheForTests();

      const robots = (await loadRobots())();
      const rule = robots.rules[0];

      expect(rule?.disallow, `${appEnv} must be fully disallowed`).toBe('/');
      expect(rule?.allow).toBeUndefined();
    }
  });

  it('allows crawling in production but blocks every private surface', async () => {
    process.env.APP_ENV = 'production';
    resetEnvCacheForTests();

    const robots = (await loadRobots())();
    const rule = robots.rules[0];
    const disallow = rule?.disallow as string[];

    expect(rule?.allow).toBe('/');

    // Master spec §39 private surfaces, in both locales.
    for (const path of [
      '/account',
      '/checkout',
      '/orders',
      '/vendor',
      '/driver',
      '/admin',
      '/api',
    ]) {
      expect(disallow, `${path} must be disallowed`).toContain(path);
    }
    for (const path of ['/hi/account', '/hi/vendor', '/hi/driver', '/hi/admin']) {
      expect(disallow, `${path} must be disallowed`).toContain(path);
    }

    // Search results are thin/duplicative and must not be indexed.
    expect(disallow).toContain('/search');
    expect(robots.sitemap).toBe('https://parthik.com/sitemap.xml');
  });
});

describe('sitemap.xml', () => {
  beforeEach(() => {
    process.env.APP_ENV = 'production';
    resetEnvCacheForTests();
  });

  it('lists the default locale unprefixed (D-33a)', async () => {
    const entries = (await loadSitemap())();
    expect(entries[0]?.url).toBe('https://parthik.com/');
  });

  it('declares an alternate for every supported locale', async () => {
    const entries = (await loadSitemap())();
    const languages = entries[0]?.alternates?.languages ?? {};

    expect(languages['en-IN']).toBe('https://parthik.com/');
    expect(languages['hi-IN']).toBe('https://parthik.com/hi');
  });

  it('does not include private routes', async () => {
    const entries = (await loadSitemap())();
    const urls = entries.map((entry) => entry.url).join(' ');

    for (const path of ['/account', '/checkout', '/vendor', '/driver', '/admin', '/login']) {
      expect(urls).not.toContain(path);
    }
  });
});
