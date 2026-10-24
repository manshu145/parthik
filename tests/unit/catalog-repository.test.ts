import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '@/db/seed/reference-data';
import { DEV_PRODUCTS } from '@/db/seed/dev-data';
import { InMemoryCatalogRepository } from '@/modules/catalog/catalog-memory.repository';
import { ADMIN_SCOPE } from '@/lib/db/repository';

/**
 * In-memory catalog repository tests.
 *
 * These are not "fake tests for a fake". The in-memory repository is what serves
 * the public preview and every other test in the suite, so its semantics — locale
 * fallback, visibility, stock derivation, sorting, keyset pagination — must match
 * the SQL. Where they diverge, everything built on top is quietly wrong.
 */

const EN = { locale: 'en' } as const;
const HI = { locale: 'hi' } as const;

function repository() {
  return new InMemoryCatalogRepository();
}

describe('category tree', () => {
  it('returns root categories with their children', async () => {
    const tree = await repository().listCategoryTree(EN);

    expect(tree).toHaveLength(CATEGORIES.length);

    const produce = tree.find((node) => node.slug === 'fruits-vegetables');
    expect(produce?.children.map((child) => child.slug)).toEqual([
      'fresh-fruits',
      'fresh-vegetables',
    ]);
  });

  it('orders roots by displayOrder, not insertion or alphabet', async () => {
    const tree = await repository().listCategoryTree(EN);
    const orders = tree.map((node) => node.displayOrder);

    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(tree[0]!.slug).toBe('fruits-vegetables');
  });

  it('localises names into Hindi', async () => {
    const tree = await repository().listCategoryTree(HI);
    const produce = tree.find((node) => node.slug === 'fruits-vegetables');

    expect(produce?.name).toBe('फल और सब्ज़ियाँ');
    expect(produce?.usedFallbackLocale).toBe(false);
  });

  it('localises child names into Hindi too', async () => {
    const tree = await repository().listCategoryTree(HI);
    const child = tree
      .flatMap((node) => node.children)
      .find((candidate) => candidate.slug === 'fresh-fruits');

    // Category names are REQUIRED in Hindi per docs/ARCHITECTURE.md §12.6.
    expect(child?.name).toBe('ताज़े फल');
  });

  it('never exposes a child as a root', async () => {
    const tree = await repository().listCategoryTree(EN);

    expect(tree.map((node) => node.slug)).not.toContain('fresh-fruits');
    expect(tree.every((node) => node.parentId === null)).toBe(true);
  });
});

describe('findCategoryBySlug', () => {
  it('returns a root category with children and no ancestors', async () => {
    const category = await repository().findCategoryBySlug('fruits-vegetables', EN);

    expect(category?.name).toBe('Fruits & Vegetables');
    expect(category?.children).toHaveLength(2);
    expect(category?.ancestors).toEqual([]);
  });

  it('returns a child category with its parent as an ancestor', async () => {
    const category = await repository().findCategoryBySlug('fresh-fruits', EN);

    // Breadcrumbs need the parent, and the tree is 2 deep by rule.
    expect(category?.ancestors).toHaveLength(1);
    expect(category?.ancestors[0]?.slug).toBe('fruits-vegetables');
    expect(category?.children).toEqual([]);
  });

  it('localises the ancestor name', async () => {
    const category = await repository().findCategoryBySlug('fresh-fruits', HI);

    expect(category?.ancestors[0]?.name).toBe('फल और सब्ज़ियाँ');
  });

  it('returns null for an unknown slug', async () => {
    expect(await repository().findCategoryBySlug('does-not-exist', EN)).toBeNull();
  });
});

describe('product reads — locale fallback', () => {
  it('returns Hindi copy when it exists', async () => {
    const product = await repository().findProductBySlug('demo-atta-5kg', HI);

    expect(product?.name).toBe('डेमो गेहूँ का आटा');
    expect(product?.usedFallbackLocale).toBe(false);
  });

  it('FALLS BACK to English when Hindi is missing, and says so', async () => {
    // The floor cleaner fixture is English-only on purpose.
    const product = await repository().findProductBySlug('demo-cleaning-liquid-1l', HI);

    expect(product?.name).toBe('Demo Floor Cleaner');
    // The flag is what lets admin find translation gaps instead of a customer
    // discovering English text on a Hindi page.
    expect(product?.usedFallbackLocale).toBe(true);
  });

  it('does not flag a fallback when the requested locale exists', async () => {
    const product = await repository().findProductBySlug('demo-cleaning-liquid-1l', EN);

    expect(product?.usedFallbackLocale).toBe(false);
  });

  it('returns null for an unknown slug', async () => {
    expect(await repository().findProductBySlug('nope', EN)).toBeNull();
  });
});

describe('product reads — pricing', () => {
  it('reports a discount percent when price is below MRP', async () => {
    const product = await repository().findProductBySlug('demo-atta-5kg', EN);

    // ₹325 -> ₹289 is 11%.
    expect(product?.mrpPaise).toBe(32_500);
    expect(product?.pricePaise).toBe(28_900);
    expect(product?.discountPercent).toBe(11);
  });

  it('reports NO discount when price equals MRP', async () => {
    // The milk fixture is deliberately undiscounted, so "0% off" can never render.
    const product = await repository().findProductBySlug('demo-full-cream-milk-1l', EN);

    expect(product?.discountPercent).toBeNull();
  });

  it('keeps money as integer paise', async () => {
    const product = await repository().findProductBySlug('demo-toor-dal-1kg', EN);

    expect(Number.isInteger(product?.pricePaise)).toBe(true);
    expect(product?.pricePaise).toBe(17_500);
  });
});

describe('product reads — stock', () => {
  it('marks a stocked product as in stock', async () => {
    const product = await repository().findProductBySlug('demo-atta-5kg', EN);

    expect(product?.inStock).toBe(true);
  });

  it('marks a zero-stock product as out of stock', async () => {
    // The tomatoes fixture has stock 0.
    const product = await repository().findProductBySlug('demo-tomatoes-1kg', EN);

    expect(product?.inStock).toBe(false);
  });

  it('excludes out-of-stock products when inStockOnly is set', async () => {
    const result = await repository().listProducts({ inStockOnly: true }, EN, { limit: 50 });

    expect(result.items.some((item) => item.slug === 'demo-tomatoes-1kg')).toBe(false);
    expect(result.items.every((item) => item.inStock)).toBe(true);
  });

  it('includes out-of-stock products by default', async () => {
    // Hiding them entirely loses a browsing signal; the card shows the state.
    const result = await repository().listProducts({}, EN, { limit: 50 });

    expect(result.items.some((item) => item.slug === 'demo-tomatoes-1kg')).toBe(true);
  });
});

describe('listProducts — filters', () => {
  it('filters by a single category', async () => {
    const staples = await repository().findCategoryBySlug('staples', EN);
    const result = await repository().listProducts({ categoryId: staples!.id }, EN, { limit: 50 });

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.slug).sort()).toEqual([
      'demo-atta-5kg',
      'demo-toor-dal-1kg',
    ]);
  });

  it('filters by several categories, as a parent page does', async () => {
    const repo = repository();
    const parent = await repo.findCategoryBySlug('fruits-vegetables', EN);
    const ids = [parent!.id, ...parent!.children.map((child) => child.id)];

    const result = await repo.listProducts({ categoryIds: ids }, EN, { limit: 50 });

    // Products live on the children, so a parent-only filter would show nothing.
    expect(result.items.map((item) => item.slug).sort()).toEqual([
      'demo-bananas-6pc',
      'demo-tomatoes-1kg',
    ]);
  });

  it('filters by price range in paise', async () => {
    const result = await repository().listProducts(
      { minPricePaise: 5_000, maxPricePaise: 20_000 },
      EN,
      { limit: 50 }
    );

    expect(result.items.every((item) => item.pricePaise >= 5_000)).toBe(true);
    expect(result.items.every((item) => item.pricePaise <= 20_000)).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('searches across both locales', async () => {
    // A Hindi term must match even when browsing in English.
    const result = await repository().listProducts({ search: 'टमाटर' }, EN, { limit: 50 });

    expect(result.items.map((item) => item.slug)).toEqual(['demo-tomatoes-1kg']);
  });

  it('searches case insensitively', async () => {
    const result = await repository().listProducts({ search: 'ATTA' }, EN, { limit: 50 });

    expect(result.items.map((item) => item.slug)).toContain('demo-atta-5kg');
  });

  it('returns an empty page rather than everything when nothing matches', async () => {
    const result = await repository().listProducts({ search: 'zzzznotathing' }, EN, { limit: 50 });

    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});

describe('listProducts — sorting and pagination', () => {
  it('sorts by price ascending', async () => {
    const result = await repository().listProducts({}, EN, { limit: 50 }, 'pricePaise:asc');
    const prices = result.items.map((item) => item.pricePaise);

    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('sorts by price descending', async () => {
    const result = await repository().listProducts({}, EN, { limit: 50 }, 'pricePaise:desc');
    const prices = result.items.map((item) => item.pricePaise);

    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  it('paginates without repeating or skipping rows', async () => {
    const repo = repository();
    const first = await repo.listProducts({}, EN, { limit: 2 });

    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await repo.listProducts({}, EN, { limit: 2, cursor: first.nextCursor! });

    const firstIds = first.items.map((item) => item.id);
    const secondIds = second.items.map((item) => item.id);

    expect(secondIds).toHaveLength(2);
    // The bug this guards against is the classic one: overlapping pages.
    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
  });

  it('walks the entire catalogue exactly once across pages', async () => {
    const repo = repository();
    const seen: string[] = [];
    let cursor: string | null = null;

    for (let guard = 0; guard < 20; guard += 1) {
      const page: Awaited<ReturnType<typeof repo.listProducts>> = await repo.listProducts(
        {},
        EN,
        cursor ? { limit: 2, cursor } : { limit: 2 }
      );
      seen.push(...page.items.map((item) => item.slug));
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(DEV_PRODUCTS.length);
    expect(new Set(seen).size).toBe(DEV_PRODUCTS.length);
  });

  it('paginates correctly when sorting by price, not just by date', async () => {
    // This is the case the shared cursor fix exists for: the keyset must compare
    // the column actually being ordered by.
    const repo = repository();
    const seen: number[] = [];
    let cursor: string | null = null;

    for (let guard = 0; guard < 20; guard += 1) {
      const page: Awaited<ReturnType<typeof repo.listProducts>> = await repo.listProducts(
        {},
        EN,
        cursor ? { limit: 2, cursor } : { limit: 2 },
        'pricePaise:asc'
      );
      seen.push(...page.items.map((item) => item.pricePaise));
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(DEV_PRODUCTS.length);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('ignores a cursor issued for a different sort key', async () => {
    const repo = repository();
    const byDate = await repo.listProducts({}, EN, { limit: 2 });

    // Changing sort while holding a cursor must restart cleanly, not return
    // arbitrary rows.
    const switched = await repo.listProducts(
      {},
      EN,
      { limit: 2, cursor: byDate.nextCursor! },
      'pricePaise:asc'
    );

    const prices = switched.items.map((item) => item.pricePaise);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(switched.items).toHaveLength(2);
  });

  it('clamps an oversized limit', async () => {
    const result = await repository().listProducts({}, EN, { limit: 5_000 });

    expect(result.items.length).toBeLessThanOrEqual(100);
  });
});

describe('product detail', () => {
  it('returns variants, store and category context', async () => {
    const detail = await repository().findProductDetailBySlug('demo-atta-5kg', EN);

    expect(detail?.variants).toHaveLength(1);
    expect(detail?.variants[0]?.isDefault).toBe(true);
    expect(detail?.variants[0]?.inStock).toBe(true);
    expect(detail?.store.slug).toBe('demo-kirana-central');
    expect(detail?.store.city).toBe('Indore');
    expect(detail?.categorySlug).toBe('staples');
    expect(detail?.categoryName).toBe('Atta, Rice & Dal');
  });

  it('localises the category name on the product page', async () => {
    const detail = await repository().findProductDetailBySlug('demo-atta-5kg', HI);

    expect(detail?.categoryName).toBe('आटा, चावल और दाल');
  });

  it('reports no images rather than a fabricated URL', async () => {
    // No image fixtures exist and the loader is still decision D-07a.
    const detail = await repository().findProductDetailBySlug('demo-atta-5kg', EN);

    expect(detail?.images).toEqual([]);
    expect(detail?.primaryImageKey).toBeNull();
  });

  it('returns null for an unknown slug', async () => {
    expect(await repository().findProductDetailBySlug('nope', EN)).toBeNull();
  });
});

describe('availability', () => {
  it('reports live stock per variant', async () => {
    const repo = repository();
    const product = await repo.findProductBySlug('demo-atta-5kg', EN);
    const availability = await repo.getProductAvailability(product!.id);

    expect(availability?.isPublished).toBe(true);
    expect(availability?.inStock).toBe(true);
    expect(availability?.variants).toHaveLength(1);
    expect(availability?.variants[0]?.quantityAvailable).toBe(40);
  });

  it('reports out of stock for a zero-quantity product', async () => {
    const repo = repository();
    const product = await repo.findProductBySlug('demo-tomatoes-1kg', EN);
    const availability = await repo.getProductAvailability(product!.id);

    expect(availability?.inStock).toBe(false);
    expect(availability?.variants[0]?.quantityAvailable).toBe(0);
  });

  it('returns null for an unknown product id', async () => {
    expect(
      await repository().getProductAvailability('00000000-0000-4000-8000-000000000000')
    ).toBeNull();
  });
});

describe('related products', () => {
  it('returns same-category products excluding the product itself', async () => {
    const repo = repository();
    const product = await repo.findProductBySlug('demo-atta-5kg', EN);
    const related = await repo.listRelatedProducts(product!.id, EN);

    expect(related.map((item) => item.slug)).toEqual(['demo-toor-dal-1kg']);
    expect(related.map((item) => item.id)).not.toContain(product!.id);
  });

  it('returns an empty list when a category has only one product', async () => {
    const repo = repository();
    const product = await repo.findProductBySlug('demo-cleaning-liquid-1l', EN);

    expect(await repo.listRelatedProducts(product!.id, EN)).toEqual([]);
  });
});

describe('determinism', () => {
  it('produces the same ids across instances', async () => {
    // Ids reach URLs, cart rows and cache keys, so they must not change between
    // requests or processes.
    const first = await new InMemoryCatalogRepository().findProductBySlug('demo-atta-5kg', EN);
    const second = await new InMemoryCatalogRepository().findProductBySlug('demo-atta-5kg', EN);

    expect(first?.id).toBe(second?.id);
  });

  it('produces uuid-shaped ids', async () => {
    const product = await repository().findProductBySlug('demo-atta-5kg', EN);

    expect(product?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('gives categories and products distinct ids', async () => {
    const repo = repository();
    const category = await repo.findCategoryBySlug('staples', EN);
    const product = await repo.findProductBySlug('demo-atta-5kg', EN);

    expect(category!.id).not.toBe(product!.id);
  });
});

describe('admin translation completeness', () => {
  it('counts the Hindi gap that the fixtures deliberately contain', async () => {
    const report = await repository().getTranslationCompleteness(ADMIN_SCOPE, 'hi');
    const products = report.find((entry) => entry.entity === 'products');

    expect(products?.total).toBe(DEV_PRODUCTS.length);
    // Exactly one fixture is English-only.
    expect(products?.missing).toBe(1);
  });

  it('reports categories as fully translated', async () => {
    const report = await repository().getTranslationCompleteness(ADMIN_SCOPE, 'hi');
    const categories = report.find((entry) => entry.entity === 'categories');

    expect(categories?.missing).toBe(0);
  });
});
