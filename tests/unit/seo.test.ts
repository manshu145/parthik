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

interface SitemapEntry {
  url: string;
  lastModified?: Date | string;
  alternates?: { languages?: Record<string, string> };
}

/**
 * The sitemap is async now that it reads the catalogue, so this awaits it.
 *
 * No database is configured in tests, so the in-memory catalog repository serves the
 * demo fixtures — which is exactly what the public preview does too.
 */
async function loadSitemap(): Promise<SitemapEntry[]> {
  vi.resetModules();
  const sitemapModule = await import('@/app/sitemap');
  return (await (sitemapModule.default as () => Promise<SitemapEntry[]>)()) as SitemapEntry[];
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
    const entries = await loadSitemap();
    expect(entries[0]?.url).toBe('https://parthik.com/');
  });

  it('declares an alternate for every supported locale', async () => {
    const entries = await loadSitemap();
    const languages = entries[0]?.alternates?.languages ?? {};

    expect(languages['en-IN']).toBe('https://parthik.com/');
    expect(languages['hi-IN']).toBe('https://parthik.com/hi');
  });

  it('declares x-default on every entry', async () => {
    // The single most common hreflang mistake. Without it Google picks a locale for
    // visitors with no language preference.
    const entries = await loadSitemap();

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.alternates?.languages?.['x-default'], `${entry.url} needs x-default`).toBe(
        entry.url
      );
    }
  });

  it('does not include private routes', async () => {
    const paths = (await loadSitemap()).map((entry) => new URL(entry.url).pathname);

    // Boundary-aware on purpose: `/vendor-registration` is a PUBLIC marketing page
    // (docs/ROUTES.md §3) and must stay in the sitemap, while the `/vendor` dashboard
    // must not. A substring check would conflate the two and either hide a real leak
    // or fail on a legitimate page.
    for (const prefix of [
      '/account',
      '/checkout',
      '/orders',
      '/favorites',
      '/vendor',
      '/driver',
      '/admin',
      '/login',
    ]) {
      for (const path of paths) {
        expect(
          path === prefix || path.startsWith(`${prefix}/`),
          `${path} must not be in the sitemap`
        ).toBe(false);
      }
    }
  });

  it('excludes the noindex search page', async () => {
    const entries = await loadSitemap();

    expect(entries.some((entry) => entry.url.includes('/search'))).toBe(false);
  });

  it('degrades to the static routes when the catalogue is unreachable', async () => {
    // This block runs with APP_ENV=production and no DATABASE_URL, so the catalogue
    // read fails by design (the in-memory repository is refused in production).
    // /sitemap.xml must still return a valid document: an error response can get the
    // whole sitemap dropped from the index, while a short one is simply re-crawled.
    const entries = await loadSitemap();

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.url.includes('/products/'))).toBe(false);
  });

  it('includes categories and products read from the catalogue', async () => {
    // The whole point of a database-driven sitemap: a new product becomes
    // discoverable without a code change. Outside production the in-memory
    // repository serves the demo fixtures, exactly as the public preview does.
    process.env.APP_ENV = 'preview';
    resetEnvCacheForTests();

    const urls = (await loadSitemap()).map((entry) => entry.url);

    expect(urls.some((url) => url.startsWith('https://parthik.com/category/'))).toBe(true);
    expect(urls).toContain('https://parthik.com/products/demo-atta-5kg');
  });

  it('gives catalogue entries hreflang too', async () => {
    process.env.APP_ENV = 'preview';
    resetEnvCacheForTests();

    const entries = await loadSitemap();
    const product = entries.find((entry) => entry.url.includes('/products/demo-atta-5kg'));

    expect(product?.alternates?.languages).toMatchObject({
      'hi-IN': 'https://parthik.com/hi/products/demo-atta-5kg',
      'x-default': 'https://parthik.com/products/demo-atta-5kg',
    });
  });

  it('gives every entry a lastModified stamp', async () => {
    for (const entry of await loadSitemap()) {
      expect(entry.lastModified, `${entry.url} needs lastModified`).toBeInstanceOf(Date);
    }
  });

  it('lists every URL exactly once', async () => {
    // A page listed twice competes with its own hreflang signals.
    const urls = (await loadSitemap()).map((entry) => entry.url);

    expect(new Set(urls).size).toBe(urls.length);
  });

  it('emits absolute https URLs', async () => {
    for (const entry of await loadSitemap()) {
      expect(entry.url).toMatch(/^https:\/\/parthik\.com\//);
    }
  });
});

describe('metadata helpers', () => {
  async function loadMetadata() {
    vi.resetModules();
    return import('@/lib/seo/metadata');
  }

  it('keeps the default locale unprefixed and prefixes the rest', async () => {
    const { canonicalUrl } = await loadMetadata();

    expect(canonicalUrl('/offers', 'en')).toBe('https://parthik.com/offers');
    expect(canonicalUrl('/offers', 'hi')).toBe('https://parthik.com/hi/offers');
  });

  it('emits the root without a trailing slash for a prefixed locale', async () => {
    // `/hi/` is not what the router serves, so a canonical pointing there would
    // disagree with the URL the visitor is actually on.
    const { canonicalUrl } = await loadMetadata();

    expect(canonicalUrl('/', 'en')).toBe('https://parthik.com/');
    expect(canonicalUrl('/', 'hi')).toBe('https://parthik.com/hi');
  });

  it('cross-references every locale plus x-default', async () => {
    const { alternatesFor } = await loadMetadata();
    const alternates = alternatesFor('/categories', 'hi');

    expect(alternates?.canonical).toBe('https://parthik.com/hi/categories');
    expect(alternates?.languages).toEqual({
      'en-IN': 'https://parthik.com/categories',
      'hi-IN': 'https://parthik.com/hi/categories',
      'x-default': 'https://parthik.com/categories',
    });
  });

  it('points x-default at the default locale, not the current one', async () => {
    const { alternatesFor } = await loadMetadata();

    for (const locale of ['en', 'hi'] as const) {
      expect(alternatesFor('/offers', locale)?.languages?.['x-default']).toBe(
        'https://parthik.com/offers'
      );
    }
  });

  it('builds matching Open Graph and Twitter copy', async () => {
    const { socialMetadata } = await loadMetadata();
    const meta = socialMetadata({
      title: 'Offers',
      description: 'Coupons and deals',
      path: '/offers',
      locale: 'en',
      siteName: 'Parthik',
    });

    // One title on Facebook and a different one on X is a bug nobody notices until
    // a share looks wrong.
    expect(meta.openGraph?.title).toBe('Offers');
    expect(meta.twitter?.title).toBe('Offers');
    // `card` is only present on the summary variants of Next's Twitter union, so the
    // narrowing is explicit rather than optional-chained away.
    expect((meta.twitter as { card?: string }).card).toBe('summary_large_image');
  });

  it('declares the other locale as an Open Graph alternate', async () => {
    const { socialMetadata } = await loadMetadata();
    const meta = socialMetadata({
      title: 'Offers',
      description: 'Coupons',
      path: '/offers',
      locale: 'en',
      siteName: 'Parthik',
    });

    expect(meta.openGraph).toMatchObject({ locale: 'en_IN', alternateLocale: ['hi_IN'] });
  });

  it('gives a noindex page neither canonical nor hreflang', async () => {
    // Pointing a crawler at a page you are also telling it to ignore is a
    // contradiction, and a canonical can carry the noindex to its target.
    const { privatePageMetadata } = await loadMetadata();
    const meta = privatePageMetadata('Cart');

    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
  });

  it('strips a trailing slash from the configured base URL', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://parthik.com/';
    resetEnvCacheForTests();

    const { canonicalUrl } = await loadMetadata();
    expect(canonicalUrl('/offers', 'en')).toBe('https://parthik.com/offers');
  });
});
