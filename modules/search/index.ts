import { getServerEnv } from '@/lib/config/env';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { getCatalogService } from '@/modules/catalog';
import { createSearchProvider } from './search.repository';
import { InMemorySearchProvider, inMemorySearchSummary } from './search-memory.repository';
import { SearchService } from './search.service';
import type { SearchProvider } from './search.types';

/**
 * Search module composition root.
 *
 * Route handlers and pages call `getSearchService()` and never construct a
 * provider, so the credential-free fallback rules live in exactly one place.
 */

export type SearchBackend = 'postgres' | 'memory';

let warnedAboutMemory = false;

/**
 * Chooses the search provider.
 *
 * PostgreSQL when a database is configured; the in-memory provider otherwise, so a
 * fresh clone and the public preview both have working search.
 *
 * In PRODUCTION the in-memory provider is never used. It ranks with a rough
 * heuristic over demo fixtures, and passing that off as real search would silently
 * degrade every result a customer sees — worse than a 503.
 */
export function resolveSearchBackend(): SearchBackend {
  const env = getServerEnv();

  if (isDatabaseConfigured()) return 'postgres';
  if (env.APP_ENV === 'production') return 'postgres';

  if (!warnedAboutMemory) {
    warnedAboutMemory = true;
    logger.info('Using the in-memory search provider — no database configured', {
      appEnv: env.APP_ENV,
    });
  }

  return 'memory';
}

async function createProvider(): Promise<SearchProvider> {
  if (resolveSearchBackend() === 'memory') {
    return new InMemorySearchProvider();
  }

  // Throws ConfigurationError (503) when unreachable, which is the correct
  // production failure.
  const db = await getDb();
  return createSearchProvider({ db });
}

export async function getSearchService(): Promise<SearchService> {
  const [provider, catalog] = await Promise.all([createProvider(), getCatalogService()]);

  return new SearchService({ provider, catalog });
}

/**
 * Backend status for development diagnostics.
 *
 * Exposed through the module rather than letting a route import the provider
 * directly, so the app/ → repository import boundary stays intact.
 */
export function describeSearchBackend(): {
  backend: SearchBackend;
  databaseConfigured: boolean;
  productSlugs: string[] | null;
  categorySlugs: string[] | null;
} {
  const backend = resolveSearchBackend();
  const summary = backend === 'memory' ? inMemorySearchSummary() : null;

  return {
    backend,
    databaseConfigured: isDatabaseConfigured(),
    productSlugs: summary?.productSlugs ?? null,
    categorySlugs: summary?.categorySlugs ?? null,
  };
}

/** Test-only: clears the one-time log guard. */
export function resetSearchBackendWarningForTests(): void {
  warnedAboutMemory = false;
}

export { SearchService, createSearchService } from './search.service';
export { InMemorySearchProvider } from './search-memory.repository';
export { PostgresSearchProvider, createSearchProvider } from './search.repository';
export { searchQuerySchema, searchTermSchema, suggestQuerySchema } from './search.schema';
export type { SearchQueryInput, SuggestQueryInput } from './search.schema';
export type { SearchResults } from './search.service';
export { MAX_SEARCH_TERM_LENGTH, MIN_SEARCH_TERM_LENGTH, SEARCH_SORT_KEYS } from './search.types';
export type {
  CategorySearchHit,
  ProductSearchQuery,
  ProductSearchResult,
  SearchProvider,
  SearchSortKey,
  SearchSuggestion,
} from './search.types';
