import type { Locale } from '@/i18n/routing';

/**
 * Search provider contract (decision D-21).
 *
 * D-21 approved PostgreSQL search **behind a swappable interface**, because the
 * Hindi stemming limitation (C-2) may force a move to Typesense or Meilisearch
 * later. That swap is only cheap if the contract looks like what a real search
 * engine returns, so this deliberately returns RANKED IDS AND SCORES — not
 * products.
 *
 * Hydration is the catalog module's job. Keeping it there means locale fallback,
 * stock derivation, discount rules and image resolution have exactly one
 * implementation, and a future search engine never has to reproduce them.
 */

export const SEARCH_SORT_KEYS = [
  'relevance',
  'pricePaise:asc',
  'pricePaise:desc',
  'createdAt:desc',
] as const;

export type SearchSortKey = (typeof SEARCH_SORT_KEYS)[number];

export interface ProductSearchQuery {
  term: string;
  locale: Locale;
  categoryIds?: readonly string[] | undefined;
  minPricePaise?: number | undefined;
  maxPricePaise?: number | undefined;
  inStockOnly?: boolean | undefined;
  sort?: SearchSortKey | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/** One matched product, identified only. Ordered by the provider's ranking. */
export interface ProductSearchHit {
  productId: string;
  /**
   * Provider-specific relevance score. Comparable WITHIN one result set only —
   * never persisted, never compared across queries or providers.
   */
  score: number;
}

export interface ProductSearchResult {
  hits: ProductSearchHit[];
  /** Total matches before pagination, so the UI can show a real count. */
  total: number;
  hasMore: boolean;
}

export interface CategorySearchHit {
  id: string;
  slug: string;
  name: string;
  score: number;
}

export interface SearchSuggestion {
  /** The completed term to search for. */
  text: string;
  kind: 'product' | 'category';
  /** Set for categories, so a suggestion can link straight to the listing. */
  slug: string | null;
}

/**
 * The swappable surface.
 *
 * `name` is reported by development diagnostics so it is always obvious which
 * engine answered — the same discipline as the maps provider.
 */
export interface SearchProvider {
  readonly name: 'postgres' | 'memory';

  searchProducts(query: ProductSearchQuery): Promise<ProductSearchResult>;

  searchCategories(term: string, locale: Locale, limit?: number): Promise<CategorySearchHit[]>;

  /** Typeahead completions. Cheap and bounded; not a full search. */
  suggest(term: string, locale: Locale, limit?: number): Promise<SearchSuggestion[]>;
}

/**
 * Shortest term that may be searched.
 *
 * Single characters match most of the catalogue, which is expensive and useless.
 * Two is enough for Devanagari, where words are short.
 */
export const MIN_SEARCH_TERM_LENGTH = 2;
export const MAX_SEARCH_TERM_LENGTH = 120;
