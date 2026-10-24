import type { Locale } from '@/i18n/routing';
import type { CatalogService } from '@/modules/catalog/catalog.service';
import type { LocalisedProduct } from '@/modules/catalog/catalog.repository.types';
import type { SearchQueryInput } from './search.schema';
import type {
  CategorySearchHit,
  SearchProvider,
  SearchSuggestion,
  SearchSortKey,
} from './search.types';

/**
 * Search service.
 *
 * Orchestrates the two halves that decision D-21 deliberately keeps apart:
 *
 *   RELEVANCE  — the swappable search provider decides what matches and in what
 *                order, and returns ids.
 *   PRESENTATION — the catalog service hydrates those ids, so locale fallback,
 *                stock derivation, discount rules and images have exactly one
 *                implementation.
 *
 * The seam is what makes replacing PostgreSQL with Typesense a contained change.
 */

export interface SearchServiceDeps {
  provider: SearchProvider;
  /** Depended on as a SERVICE, never as a repository — module boundaries hold. */
  catalog: CatalogService;
}

export interface SearchResults {
  term: string;
  products: LocalisedProduct[];
  categories: CategorySearchHit[];
  /** Total matching products before pagination, so the UI can state a real count. */
  total: number;
  hasMore: boolean;
  page: number;
  pageSize: number;
  /** Which engine answered. Reported in development diagnostics only. */
  provider: SearchProvider['name'];
}

const DEFAULT_PAGE_SIZE = 20;

export class SearchService {
  constructor(private readonly deps: SearchServiceDeps) {}

  async search(query: SearchQueryInput, locale: Locale): Promise<SearchResults> {
    const pageSize = query.limit ?? DEFAULT_PAGE_SIZE;
    const page = query.page ?? 1;
    const offset = (page - 1) * pageSize;

    // A category filter arrives as a slug and is resolved to its own id plus its
    // children's, so filtering search by a parent category behaves like browsing it.
    const categoryIds = query.category
      ? await this.resolveCategoryScope(query.category, locale)
      : undefined;

    // An unknown category slug must narrow to nothing, not silently widen to the
    // whole catalogue.
    if (query.category && categoryIds === null) {
      return this.emptyResults(query.q, page, pageSize);
    }

    const [matches, categories] = await Promise.all([
      this.deps.provider.searchProducts({
        term: query.q,
        locale,
        ...(categoryIds ? { categoryIds } : {}),
        ...(query.minPricePaise !== undefined ? { minPricePaise: query.minPricePaise } : {}),
        ...(query.maxPricePaise !== undefined ? { maxPricePaise: query.maxPricePaise } : {}),
        ...(query.inStock !== undefined ? { inStockOnly: query.inStock } : {}),
        sort: (query.sort ?? 'relevance') as SearchSortKey,
        limit: pageSize,
        offset,
      }),
      // Category matches are only useful on the first page; repeating them under
      // every page of products is noise.
      page === 1 ? this.deps.provider.searchCategories(query.q, locale, 5) : Promise.resolve([]),
    ]);

    const products = await this.deps.catalog.getProductsByIds(
      matches.hits.map((hit) => hit.productId),
      locale
    );

    return {
      term: query.q,
      products,
      categories,
      total: matches.total,
      hasMore: matches.hasMore,
      page,
      pageSize,
      provider: this.deps.provider.name,
    };
  }

  async suggest(term: string, locale: Locale, limit = 8): Promise<SearchSuggestion[]> {
    return this.deps.provider.suggest(term, locale, limit);
  }

  /** Returns null when the slug does not exist, so the caller can narrow to nothing. */
  private async resolveCategoryScope(slug: string, locale: Locale): Promise<string[] | null> {
    const page = await this.deps.catalog.getCategoryPage(slug, locale, {});
    if (!page) return null;

    return page.includedCategoryIds;
  }

  private emptyResults(term: string, page: number, pageSize: number): SearchResults {
    return {
      term,
      products: [],
      categories: [],
      total: 0,
      hasMore: false,
      page,
      pageSize,
      provider: this.deps.provider.name,
    };
  }
}

export function createSearchService(deps: SearchServiceDeps): SearchService {
  return new SearchService(deps);
}
