import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from '@/modules/catalog/catalog.service';
import { InMemoryCatalogRepository } from '@/modules/catalog/catalog-memory.repository';
import { InMemorySearchProvider } from '@/modules/search/search-memory.repository';
import { SearchService } from '@/modules/search/search.service';
import { searchQuerySchema, suggestQuerySchema } from '@/modules/search/search.schema';
import type { SearchProvider } from '@/modules/search/search.types';

/**
 * Search service tests.
 *
 * The service owns the seam decision D-21 depends on: the provider decides
 * relevance and returns ids; the catalog hydrates them. These tests are mostly
 * about that seam holding — especially that relevance ORDER survives hydration,
 * which is the thing a repository round-trip silently destroys.
 */

function service(provider: SearchProvider = new InMemorySearchProvider()) {
  const catalog = new CatalogService({ repository: new InMemoryCatalogRepository() });
  return new SearchService({ provider, catalog });
}

describe('search', () => {
  it('returns hydrated products, not bare ids', async () => {
    const results = await service().search({ q: 'atta' }, 'en');

    expect(results.products.length).toBeGreaterThan(0);
    const product = results.products[0]!;
    // Hydration is what supplies these; the provider knows none of them.
    expect(product.name).toBe('Demo Whole Wheat Atta');
    expect(product.pricePaise).toBe(28_900);
    expect(product.discountPercent).toBe(11);
    expect(product.inStock).toBe(true);
  });

  it('PRESERVES the provider relevance order through hydration', async () => {
    // The repository returns rows in its own order. If the service did not restore
    // the provider's order, results would look arbitrary while still being "correct".
    const provider = new InMemorySearchProvider();
    const ranked = await provider.searchProducts({ term: 'demo', locale: 'en' });
    const results = await service(provider).search({ q: 'demo' }, 'en');

    expect(results.products.map((product) => product.id)).toEqual(
      ranked.hits.map((hit) => hit.productId)
    );
  });

  it('reports the total from the provider, not the hydrated page length', async () => {
    const results = await service().search({ q: 'demo', limit: 2 }, 'en');

    expect(results.products).toHaveLength(2);
    expect(results.total).toBeGreaterThan(2);
    expect(results.hasMore).toBe(true);
  });

  it('reports which engine answered', async () => {
    const results = await service().search({ q: 'demo' }, 'en');
    expect(results.provider).toBe('memory');
  });

  it('returns matching categories on the first page', async () => {
    const results = await service().search({ q: 'vegetables' }, 'en');

    expect(results.categories.map((category) => category.slug)).toContain('fresh-vegetables');
  });

  it('OMITS categories on later pages', async () => {
    // Repeating category matches under every page of products is noise.
    const results = await service().search({ q: 'demo', page: 2, limit: 2 }, 'en');

    expect(results.categories).toEqual([]);
  });

  it('paginates by offset', async () => {
    const first = await service().search({ q: 'demo', limit: 2, page: 1 }, 'en');
    const second = await service().search({ q: 'demo', limit: 2, page: 2 }, 'en');

    const firstIds = first.products.map((product) => product.id);
    const secondIds = second.products.map((product) => product.id);

    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
    expect(second.page).toBe(2);
  });

  it('narrows to a category scope including its children', async () => {
    const results = await service().search({ q: 'demo', category: 'fruits-vegetables' }, 'en');

    expect(results.products.map((product) => product.slug).sort()).toEqual([
      'demo-bananas-6pc',
      'demo-tomatoes-1kg',
    ]);
  });

  it('returns NOTHING for an unknown category rather than widening', async () => {
    // Ignoring an unrecognised filter would present the whole catalogue as matches.
    const results = await service().search({ q: 'demo', category: 'not-a-category' }, 'en');

    expect(results.products).toEqual([]);
    expect(results.total).toBe(0);
  });

  it('applies the in-stock filter', async () => {
    const results = await service().search({ q: 'demo', inStock: true }, 'en');

    expect(results.products.map((product) => product.slug)).not.toContain('demo-tomatoes-1kg');
    expect(results.products.every((product) => product.inStock)).toBe(true);
  });

  it('applies price filters in paise', async () => {
    const results = await service().search({ q: 'demo', minPricePaise: 20_000 }, 'en');

    expect(results.products.every((product) => product.pricePaise >= 20_000)).toBe(true);
    expect(results.products.length).toBeGreaterThan(0);
  });

  it('passes sorting to the provider', async () => {
    const results = await service().search({ q: 'demo', sort: 'pricePaise:asc' }, 'en');
    const prices = results.products.map((product) => product.pricePaise);

    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('defaults to relevance when no sort is given', async () => {
    const provider = new InMemorySearchProvider();
    const spy = vi.spyOn(provider, 'searchProducts');

    await service(provider).search({ q: 'demo' }, 'en');

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sort: 'relevance' }));
  });

  it('returns Hindi copy for a Hindi search', async () => {
    const results = await service().search({ q: 'टमाटर' }, 'hi');

    expect(results.products[0]?.name).toBe('डेमो टमाटर');
  });

  it('falls back to English copy when a match has no Hindi translation', async () => {
    const results = await service().search({ q: 'floor cleaner' }, 'hi');

    expect(results.products[0]?.name).toBe('Demo Floor Cleaner');
    expect(results.products[0]?.usedFallbackLocale).toBe(true);
  });

  it('returns an empty page for a term matching nothing', async () => {
    const results = await service().search({ q: 'zzzznotathing' }, 'en');

    expect(results.products).toEqual([]);
    expect(results.total).toBe(0);
    expect(results.hasMore).toBe(false);
  });

  it('SKIPS an id the catalogue can no longer hydrate', async () => {
    // A product can be unpublished between the search and the hydration. One stale
    // id must degrade to a shorter list, never to a failed page.
    const provider: SearchProvider = {
      name: 'memory',
      searchProducts: async () => ({
        hits: [{ productId: '00000000-0000-4000-8000-000000000000', score: 9 }],
        total: 1,
        hasMore: false,
      }),
      searchCategories: async () => [],
      suggest: async () => [],
    };

    const results = await service(provider).search({ q: 'ghost' }, 'en');

    expect(results.products).toEqual([]);
    // The provider's total is reported honestly rather than silently corrected.
    expect(results.total).toBe(1);
  });
});

describe('suggest', () => {
  it('delegates to the provider', async () => {
    const suggestions = await service().suggest('atta', 'en');

    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('passes the limit through', async () => {
    const provider = new InMemorySearchProvider();
    const spy = vi.spyOn(provider, 'suggest');

    await service(provider).suggest('atta', 'hi', 3);

    expect(spy).toHaveBeenCalledWith('atta', 'hi', 3);
  });
});

describe('searchQuerySchema', () => {
  it('requires a term', () => {
    expect(searchQuerySchema.safeParse({}).success).toBe(false);
  });

  it('rejects a single-character term', () => {
    expect(searchQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
  });

  it('accepts a two-character term, which Devanagari needs', () => {
    expect(searchQuerySchema.safeParse({ q: 'दा' }).success).toBe(true);
  });

  it('trims the term', () => {
    expect(searchQuerySchema.parse({ q: '  atta  ' }).q).toBe('atta');
  });

  it('rejects an over-long term', () => {
    expect(searchQuerySchema.safeParse({ q: 'a'.repeat(200) }).success).toBe(false);
  });

  it('coerces page and limit', () => {
    const parsed = searchQuerySchema.parse({ q: 'atta', page: '3', limit: '10' });

    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(10);
  });

  it('rejects page zero', () => {
    expect(searchQuerySchema.safeParse({ q: 'atta', page: '0' }).success).toBe(false);
  });

  it('caps the limit', () => {
    expect(searchQuerySchema.safeParse({ q: 'atta', limit: '500' }).success).toBe(false);
  });

  it('rejects an unknown sort value', () => {
    expect(searchQuerySchema.safeParse({ q: 'atta', sort: 'costPaise:desc' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: 'atta', sort: 'relevance' }).success).toBe(true);
  });

  it('rejects unknown parameters', () => {
    expect(searchQuerySchema.safeParse({ q: 'atta', vendorId: 'x' }).success).toBe(false);
  });

  it('rejects a min price above the max', () => {
    expect(
      searchQuerySchema.safeParse({ q: 'atta', minPricePaise: '900', maxPricePaise: '100' }).success
    ).toBe(false);
  });

  it('rejects a non-boolean inStock', () => {
    expect(searchQuerySchema.safeParse({ q: 'atta', inStock: '1' }).success).toBe(false);
  });
});

describe('suggestQuerySchema', () => {
  it('bounds the limit', () => {
    expect(suggestQuerySchema.safeParse({ q: 'atta', limit: '8' }).success).toBe(true);
    expect(suggestQuerySchema.safeParse({ q: 'atta', limit: '50' }).success).toBe(false);
  });

  it('rejects unknown parameters', () => {
    expect(suggestQuerySchema.safeParse({ q: 'atta', page: '2' }).success).toBe(false);
  });
});
