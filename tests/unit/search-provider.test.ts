import { describe, expect, it } from 'vitest';
import { DEV_PRODUCTS } from '@/db/seed/dev-data';
import { fixtureId } from '@/lib/db/fixture-id';
import { InMemorySearchProvider } from '@/modules/search/search-memory.repository';
import { InMemoryCatalogRepository } from '@/modules/catalog/catalog-memory.repository';

/**
 * In-memory search provider tests.
 *
 * The provider ranks with a heuristic, not `ts_rank`, so these assert the
 * OBSERVABLE contract rather than exact scores: what matches, how filters and
 * pagination behave, that better matches outrank worse ones, and that the ids it
 * returns are the ids the catalogue can actually hydrate.
 */

function provider() {
  return new InMemorySearchProvider();
}

const EN = 'en';
const HI = 'hi';

function slugsOf(hits: Array<{ productId: string }>): string[] {
  const bySlug = new Map(DEV_PRODUCTS.map((p) => [fixtureId('product', p.slug), p.slug]));
  return hits.map((hit) => bySlug.get(hit.productId) ?? hit.productId);
}

describe('id compatibility with the catalogue', () => {
  it('returns ids the catalog repository can hydrate', async () => {
    // THE failure this guards against: search reporting matches while the
    // catalogue finds nothing, so the page shows a count with no products.
    const result = await provider().searchProducts({ term: 'atta', locale: EN });
    expect(result.hits.length).toBeGreaterThan(0);

    const catalog = new InMemoryCatalogRepository();
    const hydrated = await catalog.listProducts(
      { productIds: result.hits.map((hit) => hit.productId) },
      { locale: EN },
      { limit: 50 }
    );

    expect(hydrated.items).toHaveLength(result.hits.length);
  });

  it('derives ids identically to the catalogue for the same fixture', async () => {
    const catalog = new InMemoryCatalogRepository();
    const product = await catalog.findProductBySlug('demo-atta-5kg', { locale: EN });
    const result = await provider().searchProducts({ term: 'Demo Whole Wheat Atta', locale: EN });

    expect(result.hits[0]?.productId).toBe(product!.id);
  });
});

describe('matching', () => {
  it('finds a product by an exact name', async () => {
    const result = await provider().searchProducts({ term: 'Demo Whole Wheat Atta', locale: EN });

    expect(slugsOf(result.hits)[0]).toBe('demo-atta-5kg');
  });

  it('finds a product by a substring', async () => {
    const result = await provider().searchProducts({ term: 'atta', locale: EN });

    expect(slugsOf(result.hits)).toContain('demo-atta-5kg');
  });

  it('is case insensitive', async () => {
    const lower = await provider().searchProducts({ term: 'atta', locale: EN });
    const upper = await provider().searchProducts({ term: 'ATTA', locale: EN });

    expect(slugsOf(lower.hits)).toEqual(slugsOf(upper.hits));
  });

  it('matches a Devanagari term', async () => {
    const result = await provider().searchProducts({ term: 'टमाटर', locale: HI });

    expect(slugsOf(result.hits)).toEqual(['demo-tomatoes-1kg']);
  });

  it('matches on the short description as well as the name', async () => {
    // "Stone-ground whole wheat flour" is description-only text.
    const result = await provider().searchProducts({ term: 'stone-ground', locale: EN });

    expect(slugsOf(result.hits)).toContain('demo-atta-5kg');
  });

  it('finds an ENGLISH-ONLY product while searching in Hindi', async () => {
    // The floor cleaner has no Hindi translation. If untranslated products vanished
    // from Hindi search, the catalogue would look smaller in Hindi than it is.
    const result = await provider().searchProducts({ term: 'floor cleaner', locale: HI });

    expect(slugsOf(result.hits)).toContain('demo-cleaning-liquid-1l');
  });

  it('does NOT match Hindi copy when searching in English', async () => {
    // English requests search English only, so a Hindi-only term finds nothing —
    // the deliberate consequence of locale-scoped matching.
    const result = await provider().searchProducts({ term: 'केले', locale: EN });

    expect(result.hits).toEqual([]);
  });

  it('returns nothing for a term that matches nothing', async () => {
    const result = await provider().searchProducts({ term: 'zzzznotathing', locale: EN });

    expect(result.hits).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});

describe('ranking', () => {
  it('ranks an exact name match above a mere substring match', async () => {
    const result = await provider().searchProducts({ term: 'Demo Tomatoes', locale: EN });

    expect(slugsOf(result.hits)[0]).toBe('demo-tomatoes-1kg');
  });

  it('scores every returned hit above zero', async () => {
    const result = await provider().searchProducts({ term: 'demo', locale: EN });

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.every((hit) => hit.score > 0)).toBe(true);
  });

  it('returns hits in descending score order', async () => {
    const result = await provider().searchProducts({ term: 'demo dal', locale: EN });
    const scores = result.hits.map((hit) => hit.score);

    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('is deterministic across instances', async () => {
    const first = await new InMemorySearchProvider().searchProducts({ term: 'demo', locale: EN });
    const second = await new InMemorySearchProvider().searchProducts({ term: 'demo', locale: EN });

    expect(slugsOf(first.hits)).toEqual(slugsOf(second.hits));
  });
});

describe('filters', () => {
  it('excludes out-of-stock products when asked', async () => {
    const all = await provider().searchProducts({ term: 'demo', locale: EN });
    const inStock = await provider().searchProducts({
      term: 'demo',
      locale: EN,
      inStockOnly: true,
    });

    expect(slugsOf(all.hits)).toContain('demo-tomatoes-1kg');
    expect(slugsOf(inStock.hits)).not.toContain('demo-tomatoes-1kg');
  });

  it('filters by price range in paise', async () => {
    const result = await provider().searchProducts({
      term: 'demo',
      locale: EN,
      minPricePaise: 20_000,
    });

    // Only atta (₹289) is at or above ₹200.
    expect(slugsOf(result.hits)).toEqual(['demo-atta-5kg']);
  });

  it('filters by category', async () => {
    const catalog = new InMemoryCatalogRepository();
    const staples = await catalog.findCategoryBySlug('staples', { locale: EN });

    const result = await provider().searchProducts({
      term: 'demo',
      locale: EN,
      categoryIds: [staples!.id],
    });

    expect(slugsOf(result.hits).sort()).toEqual(['demo-atta-5kg', 'demo-toor-dal-1kg']);
  });

  it('narrows the total to match the filters', async () => {
    const result = await provider().searchProducts({
      term: 'demo',
      locale: EN,
      inStockOnly: true,
    });

    expect(result.total).toBe(result.hits.length);
  });
});

describe('sorting', () => {
  it('sorts by price ascending', async () => {
    const result = await provider().searchProducts({
      term: 'demo',
      locale: EN,
      sort: 'pricePaise:asc',
    });

    const prices = DEV_PRODUCTS.filter((p) => slugsOf(result.hits).includes(p.slug));
    const ordered = slugsOf(result.hits).map(
      (slug) => prices.find((p) => p.slug === slug)!.pricePaise
    );

    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });

  it('sorts by price descending', async () => {
    const result = await provider().searchProducts({
      term: 'demo',
      locale: EN,
      sort: 'pricePaise:desc',
    });

    const ordered = slugsOf(result.hits).map(
      (slug) => DEV_PRODUCTS.find((p) => p.slug === slug)!.pricePaise
    );

    expect(ordered).toEqual([...ordered].sort((a, b) => b - a));
  });
});

describe('pagination', () => {
  it('reports hasMore and a real total', async () => {
    const result = await provider().searchProducts({ term: 'demo', locale: EN, limit: 2 });

    expect(result.hits).toHaveLength(2);
    expect(result.total).toBeGreaterThan(2);
    expect(result.hasMore).toBe(true);
  });

  it('does not repeat rows across pages', async () => {
    const first = await provider().searchProducts({ term: 'demo', locale: EN, limit: 2 });
    const second = await provider().searchProducts({
      term: 'demo',
      locale: EN,
      limit: 2,
      offset: 2,
    });

    const firstIds = first.hits.map((hit) => hit.productId);
    const secondIds = second.hits.map((hit) => hit.productId);

    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
  });

  it('reports hasMore false on the last page', async () => {
    const all = await provider().searchProducts({ term: 'demo', locale: EN, limit: 100 });
    const last = await provider().searchProducts({
      term: 'demo',
      locale: EN,
      limit: 2,
      offset: Math.max(0, all.total - 1),
    });

    expect(last.hasMore).toBe(false);
  });

  it('clamps an oversized limit', async () => {
    const result = await provider().searchProducts({ term: 'demo', locale: EN, limit: 5_000 });

    expect(result.hits.length).toBeLessThanOrEqual(100);
  });
});

describe('category search', () => {
  it('finds a category by name', async () => {
    const results = await provider().searchCategories('vegetables', EN);

    expect(results.map((hit) => hit.slug)).toContain('fresh-vegetables');
  });

  it('returns the localised name in Hindi', async () => {
    const results = await provider().searchCategories('सब्ज़ियाँ', HI);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toMatch(/सब्ज़ियाँ/);
  });

  it('returns nothing for a non-matching term', async () => {
    expect(await provider().searchCategories('zzzznotathing', EN)).toEqual([]);
  });

  it('respects the limit', async () => {
    const results = await provider().searchCategories('a', EN, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe('suggestions', () => {
  it('suggests matching names', async () => {
    const suggestions = await provider().suggest('atta', EN);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.text.toLowerCase().includes('atta'))).toBe(true);
  });

  it('ranks a category suggestion above a product one', async () => {
    // A category leads somewhere broader than a single product.
    const suggestions = await provider().suggest('fresh', EN);

    expect(suggestions[0]?.kind).toBe('category');
  });

  it('carries a slug for categories so the UI can link straight to the listing', async () => {
    const suggestions = await provider().suggest('fresh fruits', EN);
    const category = suggestions.find((s) => s.kind === 'category');

    expect(category?.slug).toBe('fresh-fruits');
  });

  it('carries no slug for product suggestions', async () => {
    const suggestions = await provider().suggest('atta', EN);
    const product = suggestions.find((s) => s.kind === 'product');

    expect(product?.slug).toBeNull();
  });

  it('never repeats the same text', async () => {
    const suggestions = await provider().suggest('demo', EN);
    const texts = suggestions.map((s) => s.text.toLowerCase());

    expect(new Set(texts).size).toBe(texts.length);
  });

  it('respects the limit', async () => {
    const suggestions = await provider().suggest('demo', EN, 2);
    expect(suggestions).toHaveLength(2);
  });

  it('returns Hindi suggestions in Hindi', async () => {
    const suggestions = await provider().suggest('डेमो', HI);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => /डेमो/.test(s.text))).toBe(true);
  });
});
