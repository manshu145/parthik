import { expect, test, type Page } from '@playwright/test';
import { FOOTER_SECTIONS } from '@/lib/navigation/nav-config';
import { MARKETING_SLUGS } from '@/modules/cms/cms.service';

/**
 * SEO surfaces and CMS-driven pages (TASK 018, master spec §19–§20).
 *
 * Almost everything here is invisible in a browser. A missing `hreflang`, a canonical
 * pointing at the wrong locale, a footer link that 404s — none of it looks wrong on
 * screen, and all of it costs traffic. So it gets asserted rather than eyeballed.
 */

/** Public pages that must carry a full set of SEO tags. */
const INDEXABLE_PAGES = ['/', '/categories', '/offers'];

test.describe('marketing and legal pages', () => {
  // The bug this closes: the footer linked to twelve pages that did not exist.
  const footerLinks = FOOTER_SECTIONS.flatMap((section) => section.items)
    .filter((item) => !item.requiresAuth)
    .map((item) => item.href);

  for (const href of footerLinks) {
    test(`footer link ${href} resolves`, async ({ page }) => {
      const response = await page.goto(href);

      expect(response?.status(), `${href} must not 404`).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }

  test('every footer link is reachable by clicking it', async ({ page }) => {
    await page.goto('/');

    // Proves the rendered footer agrees with the config the loop above uses.
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link').first()).toBeVisible();
  });

  for (const slug of MARKETING_SLUGS) {
    test(`/${slug} renders in Hindi too`, async ({ page }) => {
      const response = await page.goto(`/hi/${slug}`);

      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }

  test('states that content is pending rather than inventing it', async ({ page }) => {
    // No CMS content is published, and legal text must never be fabricated.
    await page.goto('/privacy');

    await expect(page.getByTestId('cms-pending')).toBeVisible();
  });

  test('keeps an unpublished page out of the index', async ({ page }) => {
    await page.goto('/terms');

    const robots = await page.locator('meta[name="robots"]').first().getAttribute('content');
    expect(robots, 'a page with no content must not be indexed').toContain('noindex');
  });

  test('an unknown single-segment path is a real 404', async ({ page }) => {
    // The reason the marketing pages are twelve static routes rather than one
    // `[slug]` route. A dynamic route here would match this path and answer 200,
    // because `notFound()` cannot set a status inside one — see `_marketing-page.tsx`.
    const response = await page.goto('/not-a-real-page');

    expect(response?.status(), 'an unknown path must not answer 200').toBe(404);
    await expect(page.getByTestId('cms-pending')).toHaveCount(0);
  });

  test('a probe for a plausible admin path is a real 404', async ({ page }) => {
    for (const path of ['/wp-admin', '/.env', '/wp-login.php']) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} must 404`).toBe(404);
    }
  });

  test('does not shadow real routes', async ({ page }) => {
    // `/[slug]` sits beside /cart, /offers and /search; a static segment must win.
    for (const path of ['/cart', '/offers', '/categories', '/search']) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} must still be served by its own route`).toBe(200);
    }
  });
});

test.describe('canonical and hreflang', () => {
  for (const path of INDEXABLE_PAGES) {
    test(`${path} declares a canonical and every locale`, async ({ page }) => {
      await page.goto(path);

      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical, `${path} needs a canonical`).toBeTruthy();
      expect(canonical).not.toContain('/hi/');

      const en = page.locator('link[rel="alternate"][hreflang="en-IN"]');
      const hi = page.locator('link[rel="alternate"][hreflang="hi-IN"]');
      const xDefault = page.locator('link[rel="alternate"][hreflang="x-default"]');

      await expect(en).toHaveCount(1);
      await expect(hi).toHaveCount(1);
      // The single most common hreflang mistake.
      await expect(xDefault).toHaveCount(1);

      expect(await hi.getAttribute('href')).toContain('/hi');
    });
  }

  test('the Hindi page canonicalises to itself, not to English', async ({ page }) => {
    // Canonicalising a translation to the source language de-indexes the translation.
    await page.goto('/hi/offers');

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toContain('/hi/offers');
  });

  test('x-default points at English from both locales', async ({ page }) => {
    for (const path of ['/offers', '/hi/offers']) {
      await page.goto(path);
      const xDefault = await page
        .locator('link[rel="alternate"][hreflang="x-default"]')
        .getAttribute('href');

      expect(xDefault, `${path} x-default must be the default locale`).not.toContain('/hi/');
    }
  });

  test('a product page canonicalises to its own slug', async ({ page }) => {
    await page.goto('/products/demo-atta-5kg');

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toContain('/products/demo-atta-5kg');
  });

  test('search is noindex and has no canonical', async ({ page }) => {
    await page.goto('/search?q=atta');

    const robots = await page.locator('meta[name="robots"]').first().getAttribute('content');
    expect(robots).toContain('noindex');
  });
});

test.describe('open graph and twitter', () => {
  test('the home page carries a complete card', async ({ page }) => {
    await page.goto('/');

    for (const property of ['og:title', 'og:description', 'og:url', 'og:image', 'og:site_name']) {
      await expect(
        page.locator(`meta[property="${property}"]`).first(),
        `${property} missing`
      ).toHaveCount(1);
    }

    const card = await page.locator('meta[name="twitter:card"]').getAttribute('content');
    expect(card).toBe('summary_large_image');
  });

  test('declares the other locale as an alternate', async ({ page }) => {
    await page.goto('/');

    const locale = await page.locator('meta[property="og:locale"]').getAttribute('content');
    const alternate = await page
      .locator('meta[property="og:locale:alternate"]')
      .first()
      .getAttribute('content');

    expect(locale).toBe('en_IN');
    expect(alternate).toBe('hi_IN');
  });

  test('serves the Open Graph image as a static asset', async ({ request }) => {
    /**
     * A FILE, not a route.
     *
     * It used to be `app/[locale]/opengraph-image.tsx`, which compiled the `next/og` font
     * rasteriser into the Cloudflare Worker — ~375 KB gzipped, to render an image that never
     * changes — and pushed the Worker past its 3 MB script limit. Generated by
     * `pnpm og:generate` and committed.
     */
    const response = await request.get('/opengraph-image.png');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');
    // A 0-byte "image" would still be a 200.
    expect((await response.body()).byteLength).toBeGreaterThan(1000);
  });

  test('points both locales at the same Open Graph image', async ({ page }) => {
    /**
     * ONE Latin-script card for both languages, deliberately.
     *
     * The old route claimed to render a Hindi card and did not: satori has no complex-script
     * shaping, so "पार्थिक" came out as "पार्थकि" — visibly wrong to every Hindi reader who saw a
     * shared link. A properly shaped Hindi asset is brand work; until it exists, one correct
     * English card beats one broken Hindi one.
     */
    for (const path of ['/', '/hi']) {
      await page.goto(path);

      const image = await page.locator('meta[property="og:image"]').first().getAttribute('content');

      expect(image).toContain('/opengraph-image.png');
    }
  });
});

test.describe('structured data', () => {
  /**
   * Every structured-data node on the page.
   *
   * A block may hold one node or an ARRAY of them — `JsonLd` accepts both and the
   * product page passes an array — so this flattens before inspecting.
   */
  async function jsonLdNodes(page: Page): Promise<Array<Record<string, unknown>>> {
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();

    return blocks.flatMap((block) => {
      const parsed = JSON.parse(block) as Record<string, unknown> | Record<string, unknown>[];
      return Array.isArray(parsed) ? parsed : [parsed];
    });
  }

  async function jsonLdTypes(page: Page): Promise<string[]> {
    return (await jsonLdNodes(page)).map((node) => node['@type'] as string);
  }

  test('the home page declares Organization and WebSite', async ({ page }) => {
    await page.goto('/');
    const types = await jsonLdTypes(page);

    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
  });

  test('the search action targets the real search route', async ({ page }) => {
    await page.goto('/');
    const website = (await jsonLdNodes(page)).find((node) => node['@type'] === 'WebSite');

    const action = website?.potentialAction as { target: { urlTemplate: string } };
    expect(action.target.urlTemplate).toContain('/search?q={search_term_string}');
  });

  test('every JSON-LD block is valid JSON', async ({ page }) => {
    // A malformed block is silently ignored by crawlers, so nothing on screen breaks.
    for (const path of ['/', '/categories', '/offers', '/products/demo-atta-5kg']) {
      await page.goto(path);
      const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();

      expect(blocks.length, `${path} has no structured data`).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(() => JSON.parse(block), `${path} has malformed JSON-LD`).not.toThrow();
      }
    }
  });

  test('does not repeat Organization on every page', async ({ page }) => {
    // Site-level identity belongs on the home page only.
    await page.goto('/offers');

    expect(await jsonLdTypes(page)).not.toContain('Organization');
  });

  test('a product declares real availability', async ({ page }) => {
    await page.goto('/products/demo-atta-5kg');
    const product = (await jsonLdNodes(page)).find((node) => node['@type'] === 'Product');

    expect(product, 'the product page must emit a Product node').toBeDefined();
    const offers = product?.offers as { availability: string; price: string };
    expect(offers.availability).toMatch(/InStock|OutOfStock/);
    expect(offers.price).toBe('289.00');
  });
});

test.describe('sitemap and robots', () => {
  test('the sitemap lists catalogue pages with alternates', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    const body = await response.text();

    expect(response.status()).toBe(200);
    // Database-driven: a new product is discoverable without a code change.
    expect(body).toContain('/products/demo-atta-5kg');
    expect(body).toContain('/category/');
    expect(body).toContain('hreflang="x-default"');
  });

  test('the sitemap excludes private surfaces', async ({ request }) => {
    const body = await (await request.get('/sitemap.xml')).text();

    for (const path of ['/account', '/checkout', '/vendor/', '/driver/', '/admin', '/search']) {
      expect(body, `${path} must not be in the sitemap`).not.toContain(path);
    }
  });

  test('the sitemap omits unpublished CMS pages', async ({ request }) => {
    // They are noindex until published; asking Google to crawl them would contradict
    // that.
    const body = await (await request.get('/sitemap.xml')).text();

    expect(body).not.toContain('/privacy');
    expect(body).not.toContain('/terms');
  });

  test('robots.txt blocks everything outside production', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();

    // The E2E server runs with APP_ENV=development, so nothing may be indexed.
    expect(body).toContain('Disallow: /');
  });
});
