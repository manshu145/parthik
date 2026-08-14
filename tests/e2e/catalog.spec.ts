import { expect, test, type Page } from '@playwright/test';

/**
 * Catalog E2E tests (TASK 006).
 *
 * Run against the real pages and API with NO database and NO credentials: the
 * in-memory catalog repository, seeded from the same fixtures `pnpm seed` uses,
 * makes the whole storefront browsable on a fresh clone
 * (.kiro/steering/provider-credentials.md).
 *
 * Fixture facts these tests rely on:
 *   demo-atta-5kg          ₹289 (MRP ₹325, 11% off), staples, stock 40
 *   demo-toor-dal-1kg      ₹175, staples, stock 60
 *   demo-full-cream-milk-1l ₹72 = MRP, no discount
 *   demo-tomatoes-1kg      stock 0 — the out-of-stock case
 *   demo-cleaning-liquid-1l English-only — the Hindi fallback case
 */

const LOCALES = [
  {
    code: 'en',
    prefix: '',
    categoriesHeading: 'Shop by category',
    staples: 'Atta, Rice & Dal',
    outOfStock: 'Out of stock',
    inStock: 'In stock',
    sortPriceAsc: 'Price: low to high',
    inStockFilter: 'In stock only',
    notFoundTitle: 'Page not found',
  },
  {
    code: 'hi',
    prefix: '/hi',
    categoriesHeading: 'श्रेणी से खरीदें',
    staples: 'आटा, चावल और दाल',
    outOfStock: 'स्टॉक में नहीं',
    inStock: 'स्टॉक में है',
    sortPriceAsc: 'कीमत: कम से ज़्यादा',
    inStockFilter: 'सिर्फ़ स्टॉक में',
    notFoundTitle: 'पेज नहीं मिला',
  },
] as const;

async function jsonLdBlocks(page: Page): Promise<Array<Record<string, unknown>>> {
  const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
  return raw.flatMap((text) => {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed)
      ? (parsed as Array<Record<string, unknown>>)
      : [parsed as Record<string, unknown>];
  });
}

test.describe('catalog API', () => {
  test('returns the localised category tree', async ({ request }) => {
    const response = await request.get('/api/v1/categories');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.categories.length).toBeGreaterThan(0);

    const produce = body.data.categories.find(
      (category: { slug: string }) => category.slug === 'fruits-vegetables'
    );
    expect(produce.name).toBe('Fruits & Vegetables');
    expect(produce.children).toHaveLength(2);
  });

  test('returns Hindi category names for ?locale=hi', async ({ request }) => {
    const response = await request.get('/api/v1/categories?locale=hi');

    expect(response.headers()['content-language']).toBe('hi');

    const body = await response.json();
    const produce = body.data.categories.find(
      (category: { slug: string }) => category.slug === 'fruits-vegetables'
    );
    expect(produce.name).toBe('फल और सब्ज़ियाँ');
  });

  test('honours Accept-Language', async ({ request }) => {
    const response = await request.get('/api/v1/categories', {
      headers: { 'Accept-Language': 'hi-IN,hi;q=0.9,en;q=0.5' },
    });

    expect(response.headers()['content-language']).toBe('hi');
  });

  test('varies public catalog responses on Accept-Language', async ({ request }) => {
    // Without this a shared cache serves Hindi to the next English visitor.
    const response = await request.get('/api/v1/categories');

    expect(response.headers()['vary']).toContain('Accept-Language');
    expect(response.headers()['cache-control']).toContain('public');
  });

  test('returns a product with pricing in paise', async ({ request }) => {
    const response = await request.get('/api/v1/products/demo-atta-5kg');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.product.pricePaise).toBe(28900);
    expect(body.data.product.mrpPaise).toBe(32500);
    expect(body.data.product.discountPercent).toBe(11);
    expect(body.data.product.variants).toHaveLength(1);
  });

  test('404s an unknown product', async ({ request }) => {
    const response = await request.get('/api/v1/products/not-a-real-product');

    expect(response.status()).toBe(404);
    expect((await response.json()).error.code).toBeDefined();
  });

  test('filters products by category slug', async ({ request }) => {
    const response = await request.get('/api/v1/products?category=staples');
    const body = await response.json();

    expect(body.data.products.map((p: { slug: string }) => p.slug).sort()).toEqual([
      'demo-atta-5kg',
      'demo-toor-dal-1kg',
    ]);
  });

  test('404s an unknown category filter instead of returning everything', async ({ request }) => {
    const response = await request.get('/api/v1/products?category=not-a-category');

    expect(response.status()).toBe(404);
  });

  test('rejects an unknown query parameter', async ({ request }) => {
    const response = await request.get('/api/v1/products?vendorId=someone-else');

    expect(response.status()).toBe(422);
  });

  test('rejects a non-allowlisted sort column', async ({ request }) => {
    const response = await request.get('/api/v1/products?sort=costPaise:desc');

    expect(response.status()).toBe(422);
  });

  test('rejects unsuffixed price parameters', async ({ request }) => {
    const response = await request.get('/api/v1/products?minPrice=100');

    expect(response.status()).toBe(422);
  });

  test('sorts by price ascending', async ({ request }) => {
    const response = await request.get('/api/v1/products?sort=pricePaise:asc');
    const prices = (await response.json()).data.products.map(
      (p: { pricePaise: number }) => p.pricePaise
    );

    expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));
  });

  test('paginates with an opaque cursor without repeating rows', async ({ request }) => {
    const first = await request.get('/api/v1/products?limit=2');
    const firstBody = await first.json();

    expect(firstBody.data.products).toHaveLength(2);
    expect(firstBody.meta.nextCursor).toBeTruthy();

    const second = await request.get(
      `/api/v1/products?limit=2&cursor=${encodeURIComponent(firstBody.meta.nextCursor)}`
    );
    const secondBody = await second.json();

    const firstIds = firstBody.data.products.map((p: { id: string }) => p.id);
    const secondIds = secondBody.data.products.map((p: { id: string }) => p.id);

    expect(secondIds.filter((id: string) => firstIds.includes(id))).toEqual([]);
  });

  test('excludes out-of-stock products when asked', async ({ request }) => {
    const response = await request.get('/api/v1/products?inStock=true');
    const slugs = (await response.json()).data.products.map((p: { slug: string }) => p.slug);

    expect(slugs).not.toContain('demo-tomatoes-1kg');
  });

  test('never exposes vendor-private cost on a public surface', async ({ request }) => {
    const list = await request.get('/api/v1/products');
    const detail = await request.get('/api/v1/products/demo-atta-5kg');

    expect(await list.text()).not.toContain('costPaise');
    expect(await detail.text()).not.toContain('costPaise');
  });

  test('serves live availability with no-store', async ({ request }) => {
    const response = await request.get('/api/v1/products/demo-atta-5kg/availability');
    expect(response.status()).toBe(200);

    // Stock must never be served from a cache.
    expect(response.headers()['cache-control']).toContain('no-store');

    const body = await response.json();
    expect(body.data.availability.inStock).toBe(true);
    expect(body.data.availability.variants[0].quantityAvailable).toBe(40);
  });

  test('reports a zero-stock product as out of stock', async ({ request }) => {
    const response = await request.get('/api/v1/products/demo-tomatoes-1kg/availability');
    const body = await response.json();

    expect(body.data.availability.inStock).toBe(false);
  });

  test('returns related products from the same category', async ({ request }) => {
    const response = await request.get('/api/v1/products/demo-atta-5kg/related');
    const slugs = (await response.json()).data.products.map((p: { slug: string }) => p.slug);

    expect(slugs).toEqual(['demo-toor-dal-1kg']);
  });

  test('returns an empty related list for an unknown slug rather than failing', async ({
    request,
  }) => {
    const response = await request.get('/api/v1/products/not-real/related');

    expect(response.status()).toBe(200);
    expect((await response.json()).data.products).toEqual([]);
  });

  test('returns category detail with children and breadcrumb ancestors', async ({ request }) => {
    const response = await request.get('/api/v1/categories/fresh-fruits');
    const body = await response.json();

    expect(body.data.category.slug).toBe('fresh-fruits');
    expect(body.data.category.ancestors[0].slug).toBe('fruits-vegetables');
  });

  test('rejects a malformed slug', async ({ request }) => {
    const response = await request.get('/api/v1/categories/Not%20A%20Slug');

    expect(response.status()).toBe(422);
  });
});

test.describe('storefront pages', () => {
  for (const locale of LOCALES) {
    test(`[${locale.code}] home shows featured categories and popular products`, async ({
      page,
    }) => {
      await page.goto(`${locale.prefix}/`);

      await expect(page.getByTestId('category-grid').first()).toBeVisible();
      await expect(page.getByTestId('product-grid').first()).toBeVisible();
      await expect(page.getByTestId('product-card').first()).toBeVisible();
    });

    test(`[${locale.code}] category tree lists every category`, async ({ page }) => {
      await page.goto(`${locale.prefix}/categories`);

      await expect(page.getByRole('heading', { name: locale.categoriesHeading })).toBeVisible();
      await expect(page.getByRole('heading', { name: locale.staples })).toBeVisible();
    });

    test(`[${locale.code}] category page lists products with prices`, async ({ page }) => {
      await page.goto(`${locale.prefix}/category/staples`);

      const cards = page.getByTestId('product-card');
      await expect(cards).toHaveCount(2);
      // Money renders as rupees, never raw paise.
      await expect(page.getByTestId('product-price').first()).toContainText('₹');
      await expect(page.getByTestId('catalog-count')).toBeVisible();
    });

    test(`[${locale.code}] product page shows price, stock and store`, async ({ page }) => {
      await page.goto(`${locale.prefix}/products/demo-atta-5kg`);

      await expect(page.getByTestId('product-price').first()).toContainText('₹289');
      await expect(page.getByTestId('product-mrp').first()).toContainText('₹325');
      await expect(page.getByTestId('product-stock')).toContainText(locale.inStock);
      await expect(page.getByText('Demo Kirana — Central')).toBeVisible();
    });

    test(`[${locale.code}] out-of-stock product says so`, async ({ page }) => {
      await page.goto(`${locale.prefix}/products/demo-tomatoes-1kg`);

      await expect(page.getByTestId('product-stock')).toContainText(locale.outOfStock);
    });

    test(`[${locale.code}] sorting by price reorders the listing`, async ({ page }) => {
      await page.goto(`${locale.prefix}/category/staples`);

      await page.getByRole('link', { name: locale.sortPriceAsc }).click();

      // Cheapest first: toor dal ₹175 before atta ₹289.
      await expect(page.getByTestId('product-price').first()).toContainText('₹175');
      await expect(page).toHaveURL(/sort=pricePaise%3Aasc/);
    });

    test(`[${locale.code}] the in-stock filter is a shareable URL`, async ({ page }) => {
      await page.goto(`${locale.prefix}/category/fruits-vegetables`);

      // Tomatoes (stock 0) are present before filtering.
      await expect(page.getByTestId('product-card')).toHaveCount(2);

      await page.getByTestId('catalog-filter-instock').click();

      await expect(page).toHaveURL(/inStock=true/);
      await expect(page.getByTestId('product-card')).toHaveCount(1);
    });

    test(`[${locale.code}] shows the branded not-found page for an unknown product`, async ({
      page,
    }) => {
      await page.goto(`${locale.prefix}/products/not-a-real-product`);

      // Asserts the BEHAVIOUR we control. The HTTP status is 200 here, not 404:
      // Next.js applies automatic Suspense boundaries to dynamic routes, so the
      // response is committed before notFound() can set a status. Verified that
      // removing loading.tsx does not change it. The consequence that actually
      // matters — indexing — is prevented by robots noindex, asserted below.
      await expect(page.getByText(locale.notFoundTitle)).toBeVisible();
      await expect(page.getByTestId('product-stock')).toHaveCount(0);
    });

    test(`[${locale.code}] shows the branded not-found page for an unknown category`, async ({
      page,
    }) => {
      await page.goto(`${locale.prefix}/category/not-a-real-category`);

      await expect(page.getByText(locale.notFoundTitle)).toBeVisible();
      await expect(page.getByTestId('catalog-count')).toHaveCount(0);
    });
  }

  test('a parent category includes its children products', async ({ page }) => {
    await page.goto('/category/fruits-vegetables');

    // Products hang off the child categories, so a parent-only query would look
    // empty even though stock exists.
    await expect(page.getByTestId('product-card')).toHaveCount(2);
  });

  test('navigates from category to product', async ({ page }) => {
    await page.goto('/category/staples');
    await page.getByTestId('product-card').first().click();

    await expect(page).toHaveURL(/\/products\/demo-/);
    await expect(page.getByTestId('product-stock')).toBeVisible();
  });

  test('shows the out-of-stock badge on a listing card', async ({ page }) => {
    await page.goto('/category/fresh-vegetables');

    await expect(page.getByTestId('product-out-of-stock').first()).toBeVisible();
  });

  test('shows no discount badge on an undiscounted product', async ({ page }) => {
    // Milk is priced at MRP; a "0% off" badge would be a fake discount.
    await page.goto('/products/demo-full-cream-milk-1l');

    await expect(page.getByTestId('product-mrp')).toHaveCount(0);
  });

  test('states plainly when Hindi copy is missing', async ({ page }) => {
    await page.goto('/hi/products/demo-cleaning-liquid-1l');

    await expect(page.getByTestId('product-translation-pending')).toBeVisible();
    // The English name is shown rather than a blank.
    await expect(page.getByRole('heading', { name: 'Demo Floor Cleaner' })).toBeVisible();
  });

  test('does not claim a translation gap when Hindi exists', async ({ page }) => {
    await page.goto('/hi/products/demo-atta-5kg');

    await expect(page.getByTestId('product-translation-pending')).toHaveCount(0);
  });

  test('renders images as placeholders while the loader is undecided', async ({ page }) => {
    await page.goto('/category/staples');

    // D-07a is open, so a placeholder is correct and a broken <img> is not.
    await expect(page.getByTestId('product-image-placeholder').first()).toBeVisible();
  });
});

test.describe('catalog SEO', () => {
  test('emits Product JSON-LD with a real price and availability', async ({ page }) => {
    await page.goto('/products/demo-atta-5kg');

    const blocks = await jsonLdBlocks(page);
    const product = blocks.find((block) => block['@type'] === 'Product');

    expect(product).toBeDefined();
    const offers = product!.offers as Record<string, unknown>;
    expect(offers.price).toBe('289.00');
    expect(offers.priceCurrency).toBe('INR');
    expect(offers.availability).toBe('https://schema.org/InStock');
  });

  test('reports OutOfStock in JSON-LD for a sold-out product', async ({ page }) => {
    // Structured data must never advertise stock we do not have.
    await page.goto('/products/demo-tomatoes-1kg');

    const blocks = await jsonLdBlocks(page);
    const product = blocks.find((block) => block['@type'] === 'Product');
    const offers = product!.offers as Record<string, unknown>;

    expect(offers.availability).toBe('https://schema.org/OutOfStock');
  });

  test('omits AggregateRating when there are no reviews', async ({ page }) => {
    await page.goto('/products/demo-atta-5kg');

    const blocks = await jsonLdBlocks(page);
    const product = blocks.find((block) => block['@type'] === 'Product');

    expect(product!.aggregateRating).toBeUndefined();
  });

  test('emits BreadcrumbList on a category page', async ({ page }) => {
    await page.goto('/category/fresh-fruits');

    const blocks = await jsonLdBlocks(page);
    const breadcrumb = blocks.find((block) => block['@type'] === 'BreadcrumbList');
    const items = breadcrumb!.itemListElement as Array<Record<string, unknown>>;

    expect(items.map((item) => item.name)).toContain('Fresh Fruits');
    expect(items[0]!.position).toBe(1);
  });

  test('emits CollectionPage with the right language on a Hindi category', async ({ page }) => {
    await page.goto('/hi/category/staples');

    const blocks = await jsonLdBlocks(page);
    const collection = blocks.find((block) => block['@type'] === 'CollectionPage');

    expect(collection!.inLanguage).toBe('hi-IN');
  });

  test('sets a locale-specific canonical', async ({ page }) => {
    await page.goto('/hi/products/demo-atta-5kg');

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toContain('/hi/products/demo-atta-5kg');
  });

  test('marks the not-found page noindex so soft 404s are never indexed', async ({ page }) => {
    await page.goto('/products/not-a-real-product');

    // The mitigation for the framework's 200-status soft 404.
    const robots = await page.locator('meta[name="robots"]').first().getAttribute('content');
    expect(robots).toContain('noindex');
  });

  test('uses the resolved product name as the page title', async ({ page }) => {
    await page.goto('/products/demo-atta-5kg');

    await expect(page).toHaveTitle(/Demo Whole Wheat Atta/);
  });
});

test.describe('catalog diagnostics', () => {
  test('reports the in-memory catalog backend in development', async ({ request }) => {
    const response = await request.get('/api/v1/diagnostics/providers');
    const body = await response.json();

    expect(body.data.catalog.backend).toBe('memory');
    expect(body.data.catalog.productSlugs).toContain('demo-atta-5kg');
  });
});
