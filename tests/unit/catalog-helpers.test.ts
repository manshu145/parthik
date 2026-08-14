import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheKey,
  cacheTag,
  cacheTagAll,
  categoryCacheTags,
  NO_ZONE,
  productCacheTags,
} from '@/lib/cache/keys';
import { buildCatalogHref, buildSortOptions, firstValue } from '@/lib/catalog/query';
import { parseAcceptLanguage, publicCacheHeaders, noStoreHeaders } from '@/lib/http/request-locale';
import { breadcrumbJsonLd, collectionPageJsonLd, productJsonLd } from '@/lib/seo/json-ld';

describe('cache keys', () => {
  it('composes version, entity, id, locale and zone', () => {
    expect(cacheKey('product', 'abc', 'hi', 'ZONE-001')).toBe('v1:product:abc:hi:ZONE-001');
  });

  it('distinguishes locales', () => {
    // The bug this prevents: serving a Hindi page to an English visitor.
    expect(cacheKey('product', 'abc', 'en', 'Z')).not.toBe(cacheKey('product', 'abc', 'hi', 'Z'));
  });

  it('distinguishes zones', () => {
    // And this one: quoting one zone's delivery fee to another zone's customer.
    expect(cacheKey('home', 'root', 'en', 'ZONE-001')).not.toBe(
      cacheKey('home', 'root', 'en', 'ZONE-002')
    );
  });

  it('names the absence of a zone explicitly', () => {
    expect(cacheKey('category-tree', 'root', 'en', NO_ZONE)).toContain(':nozone');
  });

  it('strips characters that would corrupt the key structure', () => {
    expect(cacheKey('product', 'a:b c', 'en', NO_ZONE)).toBe('v1:product:a-b-c:en:nozone');
  });

  it('keeps tags free of the zone so a publish invalidates every zone', () => {
    const tag = cacheTag('product', 'abc', 'en');

    expect(tag).toBe('product:abc:en');
    expect(tag).not.toContain('nozone');
  });

  it('bundles the list tags a product publish must also invalidate', () => {
    const tags = productCacheTags('abc', 'en');

    // A stale price on a category page is as wrong as on the detail page.
    expect(tags).toContain(cacheTag('product', 'abc', 'en'));
    expect(tags).toContain(cacheTagAll('product-list'));
  });

  it('invalidates the tree when a category changes', () => {
    expect(categoryCacheTags('abc', 'hi')).toContain(cacheTagAll('category-tree'));
  });
});

describe('catalog query helpers', () => {
  it('reads the first value of a repeated param', () => {
    expect(firstValue({ sort: ['a', 'b'] }, 'sort')).toBe('a');
    expect(firstValue({ sort: 'a' }, 'sort')).toBe('a');
    expect(firstValue({}, 'sort')).toBeUndefined();
  });

  it('preserves other params when changing one', () => {
    const href = buildCatalogHref(
      '/category/staples',
      { inStock: 'true' },
      { sort: 'pricePaise:asc' }
    );

    expect(href).toContain('inStock=true');
    expect(href).toContain('sort=pricePaise%3Aasc');
  });

  it('ALWAYS drops the cursor when anything changes', () => {
    // A cursor from a previous ordering points at the wrong row.
    const href = buildCatalogHref(
      '/category/staples',
      { cursor: 'abc', sort: 'createdAt:desc' },
      { sort: 'pricePaise:asc' }
    );

    expect(href).not.toContain('cursor');
  });

  it('removes a param when passed null', () => {
    const href = buildCatalogHref('/category/staples', { inStock: 'true' }, { inStock: null });

    expect(href).toBe('/category/staples');
  });

  it('omits the query string entirely when empty', () => {
    expect(buildCatalogHref('/category/staples', {}, {})).toBe('/category/staples');
  });

  it('expresses the default sort by ABSENCE of the param', () => {
    // So the unsorted page has one canonical URL rather than two.
    const options = buildSortOptions(
      '/category/staples',
      {},
      [
        { value: 'createdAt:desc', label: 'Newest' },
        { value: 'pricePaise:asc', label: 'Cheapest' },
      ],
      'createdAt:desc'
    );

    expect(options[0]!.href).toBe('/category/staples');
    expect(options[0]!.isActive).toBe(true);
    expect(options[1]!.href).toContain('sort=pricePaise%3Aasc');
  });

  it('marks the active option from the URL', () => {
    const options = buildSortOptions(
      '/category/staples',
      { sort: 'pricePaise:asc' },
      [
        { value: 'createdAt:desc', label: 'Newest' },
        { value: 'pricePaise:asc', label: 'Cheapest' },
      ],
      'createdAt:desc'
    );

    expect(options[0]!.isActive).toBe(false);
    expect(options[1]!.isActive).toBe(true);
  });
});

describe('Accept-Language parsing', () => {
  it('picks a supported locale', () => {
    expect(parseAcceptLanguage('hi')).toBe('hi');
    expect(parseAcceptLanguage('en')).toBe('en');
  });

  it('matches a regional subtag to its base locale', () => {
    // Real browsers send hi-IN, and ignoring it would be a silent bug.
    expect(parseAcceptLanguage('hi-IN')).toBe('hi');
  });

  it('respects quality ordering rather than document order', () => {
    expect(parseAcceptLanguage('en;q=0.4,hi;q=0.9')).toBe('hi');
  });

  it('skips unsupported languages to reach a supported one', () => {
    expect(parseAcceptLanguage('de,fr;q=0.8,hi;q=0.5')).toBe('hi');
  });

  it('returns null when nothing is supported', () => {
    expect(parseAcceptLanguage('de,fr')).toBeNull();
  });

  it('returns null for an absent or empty header', () => {
    expect(parseAcceptLanguage(null)).toBeNull();
    expect(parseAcceptLanguage('')).toBeNull();
  });

  it('ignores a q=0 entry', () => {
    expect(parseAcceptLanguage('hi;q=0')).toBeNull();
  });

  it('treats a malformed q as lowest priority instead of NaN', () => {
    expect(parseAcceptLanguage('hi;q=abc,en')).toBe('en');
  });

  it('maps a wildcard to the default locale', () => {
    expect(parseAcceptLanguage('*')).toBe('en');
  });
});

describe('cache headers', () => {
  it('marks public catalog responses cacheable and varying on language', () => {
    const headers = publicCacheHeaders('hi', 300);

    expect(headers['Cache-Control']).toContain('public');
    expect(headers['Cache-Control']).toContain('s-maxage=300');
    expect(headers['Content-Language']).toBe('hi');
    // Without Vary, a shared cache serves Hindi to the next English visitor.
    expect(headers.Vary).toBe('Accept-Language');
  });

  it('marks live data uncacheable', () => {
    expect(noStoreHeaders('en')['Cache-Control']).toBe('no-store');
  });
});

describe('JSON-LD builders', () => {
  it('numbers breadcrumb positions from 1', () => {
    const data = breadcrumbJsonLd([{ name: 'Home', url: 'https://x/' }, { name: 'Staples' }]);
    const items = data.itemListElement as Array<Record<string, unknown>>;

    expect(items[0]!.position).toBe(1);
    expect(items[1]!.position).toBe(2);
    // The current page carries no item URL.
    expect(items[1]!.item).toBeUndefined();
  });

  it('converts paise to a decimal major-unit price', () => {
    const data = productJsonLd({
      name: 'Atta',
      description: null,
      url: 'https://x/products/atta',
      locale: 'en',
      sku: null,
      brandName: null,
      pricePaise: 28_900,
      inStock: true,
      ratingAvg: null,
      ratingCount: 0,
      imageUrl: null,
    });

    const offers = data.offers as Record<string, unknown>;
    expect(offers.price).toBe('289.00');
    expect(offers.priceCurrency).toBe('INR');
  });

  it('reports availability from the live flag', () => {
    const outOfStock = productJsonLd({
      name: 'Tomatoes',
      description: null,
      url: 'https://x/p',
      locale: 'en',
      sku: null,
      brandName: null,
      pricePaise: 3_900,
      inStock: false,
      ratingAvg: null,
      ratingCount: 0,
      imageUrl: null,
    });

    // Advertising stock we do not have is both an SEO and a trust problem.
    expect((outOfStock.offers as Record<string, unknown>).availability).toBe(
      'https://schema.org/OutOfStock'
    );
  });

  it('OMITS AggregateRating when there are no reviews', () => {
    const data = productJsonLd({
      name: 'Atta',
      description: null,
      url: 'https://x/p',
      locale: 'en',
      sku: null,
      brandName: null,
      pricePaise: 1_000,
      inStock: true,
      ratingAvg: null,
      ratingCount: 0,
      imageUrl: null,
    });

    // A zero-review AggregateRating is invalid structured data.
    expect(data.aggregateRating).toBeUndefined();
  });

  it('includes AggregateRating when real ratings exist', () => {
    const data = productJsonLd({
      name: 'Atta',
      description: null,
      url: 'https://x/p',
      locale: 'en',
      sku: null,
      brandName: null,
      pricePaise: 1_000,
      inStock: true,
      ratingAvg: '4.50',
      ratingCount: 12,
      imageUrl: null,
    });

    expect(data.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: '4.50',
      reviewCount: 12,
    });
  });

  it('sets inLanguage on collection pages', () => {
    const data = collectionPageJsonLd({
      name: 'Staples',
      description: null,
      url: 'https://x/c',
      locale: 'hi',
      itemCount: 2,
    });

    expect(data.inLanguage).toBe('hi-IN');
  });
});

describe('image URL resolution', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  async function loadImageModule(assetBase: string | undefined) {
    if (assetBase === undefined) delete process.env.NEXT_PUBLIC_ASSET_BASE_URL;
    else process.env.NEXT_PUBLIC_ASSET_BASE_URL = assetBase;

    vi.resetModules();
    return import('@/lib/catalog/image');
  }

  it('returns null when no asset base is configured', async () => {
    // D-07a is still open, so a guessed URL would be a broken image everywhere.
    const { imageUrlForKey, isImageDeliveryConfigured } = await loadImageModule(undefined);

    expect(isImageDeliveryConfigured()).toBe(false);
    expect(imageUrlForKey('products/atta.jpg')).toBeNull();
  });

  it('builds a URL when an asset base is configured', async () => {
    const { imageUrlForKey } = await loadImageModule('https://assets.example.com');

    expect(imageUrlForKey('products/atta.jpg')).toBe(
      'https://assets.example.com/products/atta.jpg'
    );
  });

  it('does not double up slashes', async () => {
    const { imageUrlForKey } = await loadImageModule('https://assets.example.com/');

    expect(imageUrlForKey('/products/atta.jpg')).toBe(
      'https://assets.example.com/products/atta.jpg'
    );
  });

  it('passes an already-absolute URL through unchanged', async () => {
    const { imageUrlForKey } = await loadImageModule('https://assets.example.com');

    expect(imageUrlForKey('https://cdn.other/x.jpg')).toBe('https://cdn.other/x.jpg');
  });

  it('returns null for an absent key', async () => {
    const { imageUrlForKey, resolveImage } = await loadImageModule('https://assets.example.com');

    expect(imageUrlForKey(null)).toBeNull();
    expect(resolveImage({ storageKey: null, altText: 'x' })).toBeNull();
  });

  it('carries the stored alt text through', async () => {
    const { resolveImage } = await loadImageModule('https://assets.example.com');

    expect(resolveImage({ storageKey: 'a.jpg', altText: 'Atta packet' })?.alt).toBe('Atta packet');
  });
});
