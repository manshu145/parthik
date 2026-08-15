import { expect, test } from '@playwright/test';

/**
 * Search E2E tests (TASK 007).
 *
 * Run against the real page and API with no database and no credentials — the
 * in-memory search provider and catalogue make search exercisable on a fresh clone.
 *
 * Fixture facts relied on: `demo-atta-5kg` ₹289, `demo-toor-dal-1kg` ₹175,
 * `demo-tomatoes-1kg` stock 0, `demo-cleaning-liquid-1l` English-only.
 */

const LOCALES = [
  {
    code: 'en',
    prefix: '',
    noQuery: 'What are you looking for?',
    sortPriceAsc: 'Price: low to high',
    inStockFilter: 'In stock only',
    matchingCategories: 'Matching categories',
  },
  {
    code: 'hi',
    prefix: '/hi',
    noQuery: 'आप क्या खोज रहे हैं?',
    sortPriceAsc: 'कीमत: कम से ज़्यादा',
    inStockFilter: 'सिर्फ़ स्टॉक में',
    matchingCategories: 'मिलती-जुलती श्रेणियाँ',
  },
] as const;

test.describe('search API', () => {
  test('returns hydrated products for a term', async ({ request }) => {
    const response = await request.get('/api/v1/search?q=atta');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.products.length).toBeGreaterThan(0);

    const product = body.data.products[0];
    // Hydrated through the catalogue, so it carries real presentation data.
    expect(product.name).toBe('Demo Whole Wheat Atta');
    expect(product.pricePaise).toBe(28900);
    expect(product.discountPercent).toBe(11);
    expect(typeof product.inStock).toBe('boolean');
  });

  test('reports a real total and pagination metadata', async ({ request }) => {
    const response = await request.get('/api/v1/search?q=demo&limit=2');
    const body = await response.json();

    expect(body.data.products).toHaveLength(2);
    expect(body.meta.total).toBeGreaterThan(2);
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.page).toBe(1);
  });

  test('paginates by page number without repeating rows', async ({ request }) => {
    const first = await (await request.get('/api/v1/search?q=demo&limit=2&page=1')).json();
    const second = await (await request.get('/api/v1/search?q=demo&limit=2&page=2')).json();

    const firstIds = first.data.products.map((p: { id: string }) => p.id);
    const secondIds = second.data.products.map((p: { id: string }) => p.id);

    expect(secondIds.filter((id: string) => firstIds.includes(id))).toEqual([]);
  });

  test('returns matching categories alongside products', async ({ request }) => {
    const body = await (await request.get('/api/v1/search?q=vegetables')).json();

    expect(body.data.categories.map((c: { slug: string }) => c.slug)).toContain('fresh-vegetables');
  });

  test('returns suggestions on the first page', async ({ request }) => {
    const body = await (await request.get('/api/v1/search?q=demo')).json();

    expect(Array.isArray(body.data.suggestions)).toBe(true);
    expect(body.data.suggestions.length).toBeGreaterThan(0);
  });

  test('finds Devanagari copy in Hindi', async ({ request }) => {
    const response = await request.get(
      '/api/v1/search?q=%E0%A4%9F%E0%A4%AE%E0%A4%BE%E0%A4%9F%E0%A4%B0&locale=hi'
    );
    const body = await response.json();

    expect(response.headers()['content-language']).toBe('hi');
    expect(body.data.products.map((p: { slug: string }) => p.slug)).toEqual(['demo-tomatoes-1kg']);
    expect(body.data.products[0].name).toBe('डेमो टमाटर');
  });

  test('falls back to English copy for an untranslated match in Hindi', async ({ request }) => {
    const body = await (await request.get('/api/v1/search?q=floor%20cleaner&locale=hi')).json();

    expect(body.data.products[0].name).toBe('Demo Floor Cleaner');
    expect(body.data.products[0].usedFallbackLocale).toBe(true);
  });

  test('rejects a single-character term', async ({ request }) => {
    const response = await request.get('/api/v1/search?q=a');

    expect(response.status()).toBe(422);
  });

  test('requires a term', async ({ request }) => {
    const response = await request.get('/api/v1/search');

    expect(response.status()).toBe(422);
  });

  test('rejects a non-allowlisted sort value', async ({ request }) => {
    const response = await request.get('/api/v1/search?q=demo&sort=costPaise:desc');

    expect(response.status()).toBe(422);
  });

  test('rejects unknown parameters', async ({ request }) => {
    const response = await request.get('/api/v1/search?q=demo&vendorId=someone-else');

    expect(response.status()).toBe(422);
  });

  test('SURVIVES hostile query syntax rather than erroring', async ({ request }) => {
    // websearch_to_tsquery is used precisely so a public box cannot be made to
    // raise a syntax error.
    for (const term of ['%22unclosed', 'a%20%26%20b', '-only', ':::', "o'brien"]) {
      const response = await request.get(`/api/v1/search?q=${term}`);
      expect(response.status()).toBe(200);
    }
  });

  test('applies the in-stock filter', async ({ request }) => {
    const body = await (await request.get('/api/v1/search?q=demo&inStock=true')).json();
    const slugs = body.data.products.map((p: { slug: string }) => p.slug);

    expect(slugs).not.toContain('demo-tomatoes-1kg');
  });

  test('narrows to a category and returns nothing for an unknown one', async ({ request }) => {
    const scoped = await (await request.get('/api/v1/search?q=demo&category=staples')).json();
    expect(scoped.data.products.map((p: { slug: string }) => p.slug).sort()).toEqual([
      'demo-atta-5kg',
      'demo-toor-dal-1kg',
    ]);

    const unknown = await (
      await request.get('/api/v1/search?q=demo&category=not-a-category')
    ).json();
    // Must narrow to nothing, never widen to the whole catalogue.
    expect(unknown.data.products).toEqual([]);
    expect(unknown.meta.total).toBe(0);
  });

  test('never exposes vendor-private cost', async ({ request }) => {
    const text = await (await request.get('/api/v1/search?q=demo')).text();

    expect(text).not.toContain('costPaise');
  });

  test('is publicly cacheable and varies on language', async ({ request }) => {
    const response = await request.get('/api/v1/search?q=demo');

    expect(response.headers()['cache-control']).toContain('public');
    expect(response.headers()['vary']).toContain('Accept-Language');
  });
});

test.describe('suggest API', () => {
  test('returns bounded suggestions', async ({ request }) => {
    const response = await request.get('/api/v1/search/suggest?q=de&limit=5');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.suggestions.length).toBeGreaterThan(0);
    expect(body.data.suggestions.length).toBeLessThanOrEqual(5);
  });

  test('marks category suggestions with a slug', async ({ request }) => {
    const body = await (await request.get('/api/v1/search/suggest?q=fresh')).json();
    const category = body.data.suggestions.find((s: { kind: string }) => s.kind === 'category');

    expect(category.slug).toBeTruthy();
  });

  test('rejects a too-short term', async ({ request }) => {
    expect((await request.get('/api/v1/search/suggest?q=a')).status()).toBe(422);
  });

  test('rejects unknown parameters', async ({ request }) => {
    expect((await request.get('/api/v1/search/suggest?q=demo&page=2')).status()).toBe(422);
  });
});

test.describe('search page', () => {
  for (const locale of LOCALES) {
    test(`[${locale.code}] prompts when there is no query`, async ({ page }) => {
      await page.goto(`${locale.prefix}/search`);

      await expect(page.getByText(locale.noQuery)).toBeVisible();
      await expect(page.getByTestId('product-grid')).toHaveCount(0);
    });

    test(`[${locale.code}] shows results with prices`, async ({ page }) => {
      await page.goto(`${locale.prefix}/search?q=demo`);

      await expect(page.getByTestId('product-grid')).toBeVisible();
      await expect(page.getByTestId('search-count')).toBeVisible();
      await expect(page.getByTestId('product-price').first()).toContainText('₹');
    });

    test(`[${locale.code}] states plainly when nothing matches`, async ({ page }) => {
      await page.goto(`${locale.prefix}/search?q=zzzznotathing`);

      await expect(page.getByTestId('product-grid')).toHaveCount(0);
      await expect(page.getByTestId('search-count')).toBeVisible();
    });

    test(`[${locale.code}] sorting by price is a shareable URL`, async ({ page }) => {
      await page.goto(`${locale.prefix}/search?q=demo`);

      await page.getByRole('link', { name: locale.sortPriceAsc }).click();

      await expect(page).toHaveURL(/sort=pricePaise%3Aasc/);
      // Cheapest first among the demo fixtures.
      await expect(page.getByTestId('product-price').first()).toContainText('₹39');
    });

    test(`[${locale.code}] the in-stock filter narrows results`, async ({ page }) => {
      await page.goto(`${locale.prefix}/search?q=demo`);
      const before = await page.getByTestId('product-card').count();

      await page.getByTestId('search-filter-instock').click();

      await expect(page).toHaveURL(/inStock=true/);
      expect(await page.getByTestId('product-card').count()).toBeLessThan(before);
    });

    test(`[${locale.code}] shows matching categories`, async ({ page }) => {
      await page.goto(`${locale.prefix}/search?q=fresh`);

      await expect(page.getByText(locale.matchingCategories)).toBeVisible();
      await expect(page.getByTestId('category-card').first()).toBeVisible();
    });
  }

  test('is noindex, because result pages are thin and unbounded', async ({ page }) => {
    await page.goto('/search?q=demo');

    const robots = await page.locator('meta[name="robots"]').first().getAttribute('content');
    expect(robots).toContain('noindex');
  });

  test('paginates forwards and back', async ({ page }) => {
    await page.goto('/search?q=demo&limit=2');

    await expect(page.getByTestId('search-next-page')).toBeVisible();
    await page.getByTestId('search-next-page').click();

    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByTestId('search-prev-page')).toBeVisible();

    await page.getByTestId('search-prev-page').click();
    // Page 1 is expressed by the ABSENCE of the parameter, so there is one
    // canonical URL for it.
    await expect(page).not.toHaveURL(/page=/);
  });

  test('finds a product from the header search box', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('combobox', { name: /search/i }).fill('atta');
    await page.getByRole('combobox', { name: /search/i }).press('Enter');

    await expect(page).toHaveURL(/\/search\?q=atta/);
    await expect(page.getByTestId('product-card').first()).toBeVisible();
  });

  test('navigates from a result to the product page', async ({ page }) => {
    await page.goto('/search?q=atta');

    await page.getByTestId('product-card').first().click();

    await expect(page).toHaveURL(/\/products\/demo-atta-5kg/);
  });
});

test.describe('search typeahead', () => {
  test('offers suggestions while typing and accepts one with the keyboard', async ({ page }) => {
    await page.goto('/');

    const input = page.getByRole('combobox', { name: /search/i });
    await input.fill('fresh');

    const listbox = page.getByTestId('search-suggestions');
    await expect(listbox).toBeVisible();
    await expect(input).toHaveAttribute('aria-expanded', 'true');

    // Arrow keys must move the active option without moving focus off the input.
    await input.press('ArrowDown');
    await expect(page.getByTestId('search-suggestion').first()).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await input.press('Enter');
    // The first suggestion is a category, which links straight to the listing.
    await expect(page).toHaveURL(/\/category\//);
  });

  test('closes the suggestions with Escape', async ({ page }) => {
    await page.goto('/');

    const input = page.getByRole('combobox', { name: /search/i });
    await input.fill('demo');
    await expect(page.getByTestId('search-suggestions')).toBeVisible();

    await input.press('Escape');
    await expect(page.getByTestId('search-suggestions')).toHaveCount(0);
  });

  test('does not open suggestions for a single character', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('combobox', { name: /search/i }).fill('a');
    await page.waitForTimeout(500);

    await expect(page.getByTestId('search-suggestions')).toHaveCount(0);
  });

  test('clears the box and the suggestions', async ({ page }) => {
    await page.goto('/');

    const input = page.getByRole('combobox', { name: /search/i });
    await input.fill('demo');
    await expect(page.getByTestId('search-suggestions')).toBeVisible();

    await page.getByTestId('search-clear').click();

    await expect(input).toHaveValue('');
    await expect(page.getByTestId('search-suggestions')).toHaveCount(0);
  });

  test('suggests Devanagari names in Hindi', async ({ page }) => {
    await page.goto('/hi');

    await page.getByRole('combobox', { name: /खोज|search/i }).fill('डेमो');

    await expect(page.getByTestId('search-suggestions')).toBeVisible();
    await expect(page.getByTestId('search-suggestion').first()).toContainText(/डेमो/);
  });
});

test.describe('search diagnostics', () => {
  test('reports the in-memory search backend in development', async ({ request }) => {
    const body = await (await request.get('/api/v1/diagnostics/providers')).json();

    expect(body.data.search.backend).toBe('memory');
  });
});
