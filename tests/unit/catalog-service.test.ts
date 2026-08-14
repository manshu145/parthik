import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/lib/errors';
import { CatalogService } from '@/modules/catalog/catalog.service';
import { InMemoryCatalogRepository } from '@/modules/catalog/catalog-memory.repository';
import type { CatalogRepository } from '@/modules/catalog/catalog.repository.types';

/**
 * Catalog service tests.
 *
 * The service owns the rules that would otherwise leak into pages: slug → id
 * resolution, category scope, and SEO fallback. Each is tested against behaviour a
 * customer or a crawler would notice.
 */

function service(repository: CatalogRepository = new InMemoryCatalogRepository()) {
  return new CatalogService({ repository });
}

describe('getCategoryTree', () => {
  it('returns the localised tree', async () => {
    const tree = await service().getCategoryTree('hi');

    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0]!.name).toBe('फल और सब्ज़ियाँ');
  });
});

describe('getFeaturedCategories', () => {
  it('returns only featured categories', async () => {
    const featured = await service().getFeaturedCategories('en');

    // Three fixtures are flagged featured.
    expect(featured.map((category) => category.slug)).toEqual([
      'fruits-vegetables',
      'dairy-bakery',
      'staples',
    ]);
  });

  it('falls back to the full tree when nothing is featured', async () => {
    // An empty home section is worse than showing unflagged categories.
    class NothingFeatured extends InMemoryCatalogRepository {
      override async listCategoryTree() {
        return [
          {
            id: 'a',
            slug: 'a',
            name: 'A',
            description: null,
            iconKey: null,
            imageKey: null,
            parentId: null,
            displayOrder: 1,
            isFeatured: false,
            usedFallbackLocale: false,
            children: [],
          },
        ];
      }
    }

    const featured = await service(new NothingFeatured()).getFeaturedCategories('en');
    expect(featured).toHaveLength(1);
  });

  it('respects the limit', async () => {
    const featured = await service().getFeaturedCategories('en', 2);
    expect(featured).toHaveLength(2);
  });
});

describe('getCategoryPage', () => {
  it('includes the products of child categories', async () => {
    // Browsing a parent must not look empty because products hang off children.
    const page = await service().getCategoryPage('fruits-vegetables', 'en', {});

    expect(page).not.toBeNull();
    expect(page!.includedCategoryIds).toHaveLength(3);
    expect(page!.products.items.map((item) => item.slug).sort()).toEqual([
      'demo-bananas-6pc',
      'demo-tomatoes-1kg',
    ]);
  });

  it('returns a leaf category with only its own products', async () => {
    const page = await service().getCategoryPage('staples', 'en', {});

    expect(page!.includedCategoryIds).toHaveLength(1);
    expect(page!.products.items).toHaveLength(2);
  });

  it('returns null for an unknown slug so the page can 404', async () => {
    expect(await service().getCategoryPage('nope', 'en', {})).toBeNull();
  });

  it('passes the in-stock filter through', async () => {
    const page = await service().getCategoryPage('fruits-vegetables', 'en', { inStock: true });

    expect(page!.products.items.map((item) => item.slug)).toEqual(['demo-bananas-6pc']);
  });

  it('passes sorting through', async () => {
    const page = await service().getCategoryPage('staples', 'en', { sort: 'pricePaise:asc' });
    const prices = page!.products.items.map((item) => item.pricePaise);

    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('derives SEO copy from the category when none is authored', async () => {
    // A page shipped with an empty title is an SEO own-goal.
    const page = await service().getCategoryPage('staples', 'en', {});

    expect(page!.seo.title).toBe('Atta, Rice & Dal');
    expect(page!.seo.description).toBe('Everyday staples');
  });

  it('prefers authored SEO copy over the category name', async () => {
    // Subclassed, not spread: the repository's methods live on the prototype, so
    // an object spread would silently drop every one of them.
    class AuthoredSeo extends InMemoryCatalogRepository {
      override async findCategoryBySlug(slug: string, locale: { locale: 'en' | 'hi' }) {
        const category = await super.findCategoryBySlug(slug, locale);
        return category ? { ...category, metaTitle: 'Authored title' } : null;
      }
    }

    const page = await service(new AuthoredSeo()).getCategoryPage('staples', 'en', {});
    expect(page!.seo.title).toBe('Authored title');
  });
});

describe('listProducts', () => {
  it('resolves a category slug to its scope', async () => {
    const result = await service().listProducts({ category: 'fruits-vegetables' }, 'en');

    expect(result.items.map((item) => item.slug).sort()).toEqual([
      'demo-bananas-6pc',
      'demo-tomatoes-1kg',
    ]);
  });

  it('THROWS for an unknown category rather than returning everything', async () => {
    // Silently returning the whole catalogue would present unrelated products as
    // matches, which is worse than an error.
    await expect(service().listProducts({ category: 'nope' }, 'en')).rejects.toThrow(NotFoundError);
  });

  it('returns the whole catalogue when no category is given', async () => {
    const result = await service().listProducts({}, 'en');
    expect(result.items.length).toBeGreaterThan(2);
  });

  it('forwards price filters as paise', async () => {
    const spy = vi.spyOn(InMemoryCatalogRepository.prototype, 'listProducts');
    const repo = new InMemoryCatalogRepository();

    await service(repo).listProducts({ minPricePaise: 5_000, maxPricePaise: 20_000 }, 'en');

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ minPricePaise: 5_000, maxPricePaise: 20_000 }),
      { locale: 'en' },
      expect.anything(),
      undefined
    );
    spy.mockRestore();
  });
});

describe('getProductPage', () => {
  it('returns detail plus related products', async () => {
    const page = await service().getProductPage('demo-atta-5kg', 'en');

    expect(page!.product.name).toBe('Demo Whole Wheat Atta');
    expect(page!.related.map((item) => item.slug)).toEqual(['demo-toor-dal-1kg']);
  });

  it('derives SEO from the product when none is authored', async () => {
    const page = await service().getProductPage('demo-atta-5kg', 'en');

    expect(page!.seo.title).toBe('Demo Whole Wheat Atta');
    expect(page!.seo.description).toBe('Stone-ground whole wheat flour');
  });

  it('returns null for an unknown slug', async () => {
    expect(await service().getProductPage('nope', 'en')).toBeNull();
  });

  it('serves English copy on a Hindi page when translation is missing', async () => {
    const page = await service().getProductPage('demo-cleaning-liquid-1l', 'hi');

    expect(page!.product.name).toBe('Demo Floor Cleaner');
    expect(page!.product.usedFallbackLocale).toBe(true);
  });
});

describe('getAvailabilityBySlug', () => {
  it('resolves the slug and returns live stock', async () => {
    const availability = await service().getAvailabilityBySlug('demo-atta-5kg', 'en');

    expect(availability?.inStock).toBe(true);
    expect(availability?.variants[0]?.quantityAvailable).toBe(40);
  });

  it('returns null for an unknown slug', async () => {
    expect(await service().getAvailabilityBySlug('nope', 'en')).toBeNull();
  });

  it('reports out of stock without throwing', async () => {
    const availability = await service().getAvailabilityBySlug('demo-tomatoes-1kg', 'en');

    expect(availability?.inStock).toBe(false);
  });
});

describe('getPopularProducts', () => {
  it('returns products up to the limit', async () => {
    const popular = await service().getPopularProducts('en', 3);
    expect(popular).toHaveLength(3);
  });
});

describe('getRelatedProducts', () => {
  it('returns an empty list for an unknown slug rather than throwing', async () => {
    // A recommendations block must never be able to fail a product page.
    expect(await service().getRelatedProducts('nope', 'en')).toEqual([]);
  });
});
