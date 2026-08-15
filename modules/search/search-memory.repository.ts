import { CATEGORIES } from '@/db/seed/reference-data';
import { DEV_PRODUCTS } from '@/db/seed/dev-data';
import { defaultLocale, type Locale } from '@/i18n/routing';
import { fixtureId } from '@/lib/db/fixture-id';
import { resolveLimit } from '@/lib/db/repository';
import type {
  CategorySearchHit,
  ProductSearchQuery,
  ProductSearchResult,
  SearchProvider,
  SearchSuggestion,
} from './search.types';

/**
 * In-memory search provider.
 *
 * WHY THIS EXISTS: the application must run and pass its full test suite with no
 * external dependencies (.kiro/steering/provider-credentials.md). Without it the
 * search page could only ever render an error on the public preview.
 *
 * SINGLE SOURCE OF TRUTH: it reads the same seed fixtures as the in-memory catalog
 * repository, and derives ids with the SAME shared `fixtureId` helper. That is
 * load-bearing — search returns ids and the catalog hydrates them, so any drift
 * would produce a non-zero result count with nothing rendered.
 *
 * ⚠️ IT APPROXIMATES RANKING, AND DOES NOT PRETEND OTHERWISE. PostgreSQL scores with
 * `ts_rank` plus trigram similarity; reproducing that in TypeScript would be a
 * fiction. What IS faithful — and what the tests assert — is the observable
 * contract: which products match, how filters and pagination behave, that better
 * matches outrank worse ones, and that ordering is deterministic. Exact score
 * parity is explicitly not guaranteed.
 *
 * Refused in production by modules/search/index.ts.
 */

interface MemoryProductDocument {
  productId: string;
  categoryId: string;
  pricePaise: number;
  inStock: boolean;
  /** Ordinal from the fixture order, used as a stable recency proxy. */
  ordinal: number;
  /** Searchable text per locale. */
  text: Array<{ locale: Locale; name: string; shortDescription: string }>;
}

interface MemoryCategoryDocument {
  id: string;
  slug: string;
  displayOrder: number;
  names: Array<{ locale: Locale; name: string }>;
}

function buildProductDocuments(): MemoryProductDocument[] {
  const categoryIdBySlug = new Map<string, string>();

  for (const category of CATEGORIES) {
    categoryIdBySlug.set(category.slug, fixtureId('category', category.slug));
    for (const child of category.children ?? []) {
      categoryIdBySlug.set(child.slug, fixtureId('category', child.slug));
    }
  }

  return DEV_PRODUCTS.map((product, index) => ({
    productId: fixtureId('product', product.slug),
    categoryId: categoryIdBySlug.get(product.categorySlug) ?? '',
    pricePaise: product.pricePaise,
    inStock: product.stock > 0,
    ordinal: index,
    text: Object.entries(product.translations).map(([locale, content]) => ({
      locale: locale as Locale,
      name: content.name,
      shortDescription: content.shortDescription,
    })),
  }));
}

function buildCategoryDocuments(): MemoryCategoryDocument[] {
  const documents: MemoryCategoryDocument[] = [];

  for (const category of CATEGORIES) {
    documents.push({
      id: fixtureId('category', category.slug),
      slug: category.slug,
      displayOrder: category.displayOrder,
      names: Object.entries(category.translations).map(([locale, content]) => ({
        locale: locale as Locale,
        name: content.name,
      })),
    });

    for (const child of category.children ?? []) {
      documents.push({
        id: fixtureId('category', child.slug),
        slug: child.slug,
        displayOrder: child.displayOrder,
        names: Object.entries(child.translations).map(([locale, content]) => ({
          locale: locale as Locale,
          name: content.name,
        })),
      });
    }
  }

  return documents;
}

/**
 * Score for one field.
 *
 * Ordered so that a stronger match always outranks a weaker one, which is the
 * property the UI and the tests actually depend on.
 */
function scoreText(haystack: string, needle: string): number {
  const text = haystack.toLowerCase();
  const term = needle.toLowerCase();

  if (text === term) return 4;
  if (text.startsWith(term)) return 3;
  if (text.includes(term)) return 2;

  // Whole-word overlap, so "wheat atta" still finds "Whole Wheat Atta".
  const words = new Set(text.split(/\s+/));
  const overlap = term.split(/\s+/).filter((word) => word.length > 0 && words.has(word)).length;

  return overlap > 0 ? 1 : 0;
}

/** Locales searched: the requested one, plus English so untranslated rows still match. */
function searchableLocales(locale: Locale): Locale[] {
  return locale === defaultLocale ? [locale] : [locale, defaultLocale];
}

export class InMemorySearchProvider implements SearchProvider {
  readonly name = 'memory' as const;

  private readonly products: MemoryProductDocument[];
  private readonly categories: MemoryCategoryDocument[];

  constructor(
    products: MemoryProductDocument[] = buildProductDocuments(),
    categories: MemoryCategoryDocument[] = buildCategoryDocuments()
  ) {
    this.products = products;
    this.categories = categories;
  }

  private scoreProduct(document: MemoryProductDocument, term: string, locale: Locale): number {
    const locales = searchableLocales(locale);
    let best = 0;

    for (const entry of document.text) {
      if (!locales.includes(entry.locale)) continue;

      // Name dominates description, mirroring the SQL weighting.
      const score = scoreText(entry.name, term) + scoreText(entry.shortDescription, term) * 0.4;

      best = Math.max(best, score);
    }

    return best;
  }

  async searchProducts(query: ProductSearchQuery): Promise<ProductSearchResult> {
    const limit = resolveLimit(query.limit);
    const offset = Math.max(0, query.offset ?? 0);

    const scored = this.products
      .map((document) => ({
        document,
        score: this.scoreProduct(document, query.term, query.locale),
      }))
      .filter((entry) => entry.score > 0)
      .filter(({ document }) => {
        if (query.categoryIds && query.categoryIds.length > 0) {
          if (!query.categoryIds.includes(document.categoryId)) return false;
        }
        if (query.minPricePaise !== undefined && document.pricePaise < query.minPricePaise) {
          return false;
        }
        if (query.maxPricePaise !== undefined && document.pricePaise > query.maxPricePaise) {
          return false;
        }
        if (query.inStockOnly && !document.inStock) return false;
        return true;
      });

    const sorted = [...scored].sort((a, b) => {
      switch (query.sort) {
        case 'pricePaise:asc':
          return (
            a.document.pricePaise - b.document.pricePaise || a.document.ordinal - b.document.ordinal
          );
        case 'pricePaise:desc':
          return (
            b.document.pricePaise - a.document.pricePaise || a.document.ordinal - b.document.ordinal
          );
        case 'createdAt:desc':
          return b.document.ordinal - a.document.ordinal;
        case 'relevance':
        default:
          // Ordinal descending as the tie-break, matching the SQL's
          // `created_at desc` — fixtures are ordered oldest-first.
          return b.score - a.score || b.document.ordinal - a.document.ordinal;
      }
    });

    const page = sorted.slice(offset, offset + limit);

    return {
      hits: page.map((entry) => ({ productId: entry.document.productId, score: entry.score })),
      total: sorted.length,
      hasMore: offset + page.length < sorted.length,
    };
  }

  async searchCategories(term: string, locale: Locale, limit = 5): Promise<CategorySearchHit[]> {
    const locales = searchableLocales(locale);

    return this.categories
      .map((document) => {
        const relevant = document.names.filter((entry) => locales.includes(entry.locale));
        const score = relevant.reduce(
          (best, entry) => Math.max(best, scoreText(entry.name, term)),
          0
        );

        const display =
          relevant.find((entry) => entry.locale === locale) ??
          relevant.find((entry) => entry.locale === defaultLocale);

        return { document, score, name: display?.name ?? document.slug };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.document.displayOrder - b.document.displayOrder)
      .slice(0, resolveLimit(limit))
      .map((entry) => ({
        id: entry.document.id,
        slug: entry.document.slug,
        name: entry.name,
        score: entry.score,
      }));
  }

  async suggest(term: string, locale: Locale, limit = 8): Promise<SearchSuggestion[]> {
    const locales = searchableLocales(locale);
    const scored: Array<{
      text: string;
      kind: 'product' | 'category';
      slug: string | null;
      score: number;
    }> = [];

    // Categories rank above products: they lead somewhere broader.
    for (const document of this.categories) {
      for (const entry of document.names) {
        if (!locales.includes(entry.locale)) continue;
        const score = scoreText(entry.name, term);
        if (score > 0) {
          scored.push({
            text: entry.name,
            kind: 'category',
            slug: document.slug,
            score: score + 1,
          });
        }
      }
    }

    for (const document of this.products) {
      for (const entry of document.text) {
        if (!locales.includes(entry.locale)) continue;
        const score = scoreText(entry.name, term);
        if (score > 0) scored.push({ text: entry.name, kind: 'product', slug: null, score });
      }
    }

    const seen = new Set<string>();
    const unique: SearchSuggestion[] = [];

    for (const entry of scored.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))) {
      const key = entry.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ text: entry.text, kind: entry.kind, slug: entry.slug });
      if (unique.length >= resolveLimit(limit)) break;
    }

    return unique;
  }
}

/** Fixture slugs the in-memory provider can match. Used by development diagnostics. */
export function inMemorySearchSummary(): { productSlugs: string[]; categorySlugs: string[] } {
  return {
    productSlugs: DEV_PRODUCTS.map((product) => product.slug),
    categorySlugs: buildCategoryDocuments().map((document) => document.slug),
  };
}
