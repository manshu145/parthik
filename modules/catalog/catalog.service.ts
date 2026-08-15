import type { Locale } from '@/i18n/routing';
import type { CursorResult } from '@/lib/db/repository';
import { NotFoundError } from '@/lib/errors';
import type {
  CatalogRepository,
  CategoryDetail,
  CategoryTreeNode,
  LocalisedProduct,
  LocalisedProductDetail,
  ProductAvailability,
} from './catalog.repository.types';
import type { ProductListQuery } from './catalog.schema';

/**
 * Catalog service.
 *
 * Owns the read rules that must not live in a route handler or a page:
 *
 *   - Slug → id resolution. Ids never appear in a URL, so every public entry
 *     point is a slug and the service is the only thing that translates.
 *   - Category scope. Browsing a parent category includes its children's
 *     products, otherwise a parent page looks empty while stock clearly exists.
 *   - SEO fallback. Authored meta copy wins; otherwise it is derived from the
 *     content, so a page is never shipped with an empty title.
 *
 * All I/O is injected, so the whole surface is testable with no database.
 */

export interface CatalogServiceDeps {
  repository: CatalogRepository;
}

/** Resolved SEO copy for a page. Never empty. */
export interface ResolvedSeo {
  title: string;
  description: string | null;
}

export interface CategoryPageResult {
  category: CategoryDetail;
  products: CursorResult<LocalisedProduct>;
  /** The categories whose products are included: this one plus its children. */
  includedCategoryIds: string[];
  seo: ResolvedSeo;
}

export interface ProductPageResult {
  product: LocalisedProductDetail;
  related: LocalisedProduct[];
  seo: ResolvedSeo;
}

export class CatalogService {
  constructor(private readonly deps: CatalogServiceDeps) {}

  async getCategoryTree(locale: Locale): Promise<CategoryTreeNode[]> {
    return this.deps.repository.listCategoryTree({ locale });
  }

  /** Featured root categories for the home page, in authored order. */
  async getFeaturedCategories(locale: Locale, limit = 6): Promise<CategoryTreeNode[]> {
    const tree = await this.deps.repository.listCategoryTree({ locale });
    const featured = tree.filter((category) => category.isFeatured);

    // Fall back to the full tree rather than rendering an empty home section when
    // nothing has been flagged as featured yet.
    return (featured.length > 0 ? featured : tree).slice(0, limit);
  }

  async listProducts(
    query: ProductListQuery,
    locale: Locale
  ): Promise<CursorResult<LocalisedProduct>> {
    const categoryIds = query.category
      ? await this.resolveCategoryScope(query.category, locale)
      : undefined;

    // A category slug that does not exist must not silently return the whole
    // catalogue — that would present unrelated products as if they matched.
    if (query.category && (!categoryIds || categoryIds.length === 0)) {
      throw new NotFoundError('That category could not be found.');
    }

    return this.deps.repository.listProducts(
      {
        ...(categoryIds ? { categoryIds } : {}),
        ...(query.minPricePaise !== undefined ? { minPricePaise: query.minPricePaise } : {}),
        ...(query.maxPricePaise !== undefined ? { maxPricePaise: query.maxPricePaise } : {}),
        ...(query.inStock !== undefined ? { inStockOnly: query.inStock } : {}),
        ...(query.search ? { search: query.search } : {}),
      },
      { locale },
      {
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      },
      query.sort
    );
  }

  async getCategoryPage(
    slug: string,
    locale: Locale,
    query: Omit<ProductListQuery, 'category'>
  ): Promise<CategoryPageResult | null> {
    const category = await this.deps.repository.findCategoryBySlug(slug, { locale });
    if (!category) return null;

    const includedCategoryIds = [category.id, ...category.children.map((child) => child.id)];

    const products = await this.deps.repository.listProducts(
      {
        categoryIds: includedCategoryIds,
        ...(query.minPricePaise !== undefined ? { minPricePaise: query.minPricePaise } : {}),
        ...(query.maxPricePaise !== undefined ? { maxPricePaise: query.maxPricePaise } : {}),
        ...(query.inStock !== undefined ? { inStockOnly: query.inStock } : {}),
        ...(query.search ? { search: query.search } : {}),
      },
      { locale },
      {
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      },
      query.sort
    );

    return {
      category,
      products,
      includedCategoryIds,
      seo: {
        title: category.metaTitle ?? category.name,
        description: category.metaDescription ?? category.description,
      },
    };
  }

  async getProductPage(slug: string, locale: Locale): Promise<ProductPageResult | null> {
    const product = await this.deps.repository.findProductDetailBySlug(slug, { locale });
    if (!product) return null;

    const related = await this.deps.repository.listRelatedProducts(product.id, { locale }, 8);

    return {
      product,
      related,
      seo: {
        title: product.metaTitle ?? product.name,
        description: product.metaDescription ?? product.shortDescription,
      },
    };
  }

  /**
   * Live price and stock.
   *
   * Deliberately separate from the product read so the page can cache the
   * description and imagery while still asking for availability on every request
   * (docs/ROUTES.md §4). Serving cached stock is how a customer pays for something
   * that is already gone.
   */
  async getAvailability(productId: string): Promise<ProductAvailability | null> {
    return this.deps.repository.getProductAvailability(productId);
  }

  /**
   * Live availability addressed by slug.
   *
   * Public surfaces address products by slug, so this resolves the id internally
   * rather than exposing one in a URL. Two reads, but the second is the cheap
   * inventory query and neither is cached.
   */
  async getAvailabilityBySlug(slug: string, locale: Locale): Promise<ProductAvailability | null> {
    const product = await this.deps.repository.findProductBySlug(slug, { locale });
    if (!product) return null;

    return this.deps.repository.getProductAvailability(product.id);
  }

  async getRelatedProducts(
    productSlug: string,
    locale: Locale,
    limit = 8
  ): Promise<LocalisedProduct[]> {
    const product = await this.deps.repository.findProductBySlug(productSlug, { locale });
    if (!product) return [];

    return this.deps.repository.listRelatedProducts(product.id, { locale }, limit);
  }

  /**
   * Hydrates specific products, PRESERVING THE GIVEN ORDER.
   *
   * This is how search renders results: the search provider decides relevance and
   * returns ids, then this fills in names, prices, stock and images. Keeping
   * hydration here means locale fallback, discount rules and stock derivation have
   * one implementation, and a future search engine (D-21) never reproduces them.
   *
   * Order preservation is the whole point — the repository returns rows in its own
   * order, and re-sorting by relevance is impossible once the scores are gone.
   */
  async getProductsByIds(ids: readonly string[], locale: Locale): Promise<LocalisedProduct[]> {
    if (ids.length === 0) return [];

    const result = await this.deps.repository.listProducts(
      { productIds: ids },
      { locale },
      // The id list is already bounded by the caller's page size; asking for its
      // exact length avoids a second page being silently dropped.
      { limit: ids.length }
    );

    const byId = new Map(result.items.map((item) => [item.id, item]));

    // Missing ids are skipped rather than throwing: a product can be unpublished
    // between the search and the hydration, and one stale id must not fail the page.
    return ids
      .map((id) => byId.get(id))
      .filter((item): item is LocalisedProduct => item !== undefined);
  }

  /** Popular products for the home page. */
  async getPopularProducts(locale: Locale, limit = 8): Promise<LocalisedProduct[]> {
    const result = await this.deps.repository.listProducts(
      {},
      { locale },
      { limit },
      'soldCount:desc'
    );
    return result.items;
  }

  /** A category plus its children — the set a category page browses. */
  private async resolveCategoryScope(slug: string, locale: Locale): Promise<string[] | null> {
    const category = await this.deps.repository.findCategoryBySlug(slug, { locale });
    if (!category) return null;

    return [category.id, ...category.children.map((child) => child.id)];
  }
}

export function createCatalogService(deps: CatalogServiceDeps): CatalogService {
  return new CatalogService(deps);
}
