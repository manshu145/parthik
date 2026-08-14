import { getServerEnv } from '@/lib/config/env';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { createCatalogRepository } from './catalog.repository';
import { InMemoryCatalogRepository, inMemoryCatalogSummary } from './catalog-memory.repository';
import type { CatalogRepository } from './catalog.repository.types';
import { CatalogService } from './catalog.service';

/**
 * Catalog module composition root.
 *
 * Route handlers and pages call `getCatalogService()` and never construct a
 * repository, so the credential-free fallback rules live in exactly one place.
 */

export type CatalogBackend = 'postgres' | 'memory';

let warnedAboutMemory = false;

/**
 * Chooses the repository implementation.
 *
 * Postgres when a connection is configured; the in-memory fixture otherwise, so a
 * fresh clone and the public preview both show a real catalogue.
 *
 * In PRODUCTION the in-memory fixture is never used. Demo products appearing in a
 * real storefront — customers ordering "Demo Toor Dal" — would be an incident, so
 * the database error is allowed to surface instead.
 */
export function resolveCatalogBackend(): CatalogBackend {
  const env = getServerEnv();

  if (isDatabaseConfigured()) return 'postgres';
  if (env.APP_ENV === 'production') return 'postgres';

  if (!warnedAboutMemory) {
    warnedAboutMemory = true;
    logger.info('Using the in-memory catalog repository — no database configured', {
      appEnv: env.APP_ENV,
    });
  }

  return 'memory';
}

async function createRepository(): Promise<CatalogRepository> {
  if (resolveCatalogBackend() === 'memory') {
    return new InMemoryCatalogRepository();
  }

  // Throws ConfigurationError (503) when unreachable, which is the correct
  // production failure.
  const db = await getDb();
  return createCatalogRepository({ db });
}

export async function getCatalogService(): Promise<CatalogService> {
  return new CatalogService({ repository: await createRepository() });
}

/**
 * Backend status for development diagnostics.
 *
 * Exposed through the module rather than letting a route import the repository
 * directly, so the app/ → repository import boundary stays intact.
 */
export function describeCatalogBackend(): {
  backend: CatalogBackend;
  databaseConfigured: boolean;
  categorySlugs: string[] | null;
  productSlugs: string[] | null;
} {
  const backend = resolveCatalogBackend();
  const summary = backend === 'memory' ? inMemoryCatalogSummary() : null;

  return {
    backend,
    databaseConfigured: isDatabaseConfigured(),
    categorySlugs: summary?.categorySlugs ?? null,
    productSlugs: summary?.productSlugs ?? null,
  };
}

/** Test-only: clears the one-time log guard. */
export function resetCatalogBackendWarningForTests(): void {
  warnedAboutMemory = false;
}

export { CatalogService, createCatalogService } from './catalog.service';
export { InMemoryCatalogRepository } from './catalog-memory.repository';
export { createCatalogRepository, DrizzleCatalogRepository } from './catalog.repository';
export {
  categorySlugParamSchema,
  productIdParamSchema,
  productListQuerySchema,
  productSlugParamSchema,
  relatedProductsQuerySchema,
  slugSchema,
} from './catalog.schema';
export type { ProductListQuery, RelatedProductsQuery } from './catalog.schema';
export type { CategoryPageResult, ProductPageResult, ResolvedSeo } from './catalog.service';
export type {
  CatalogRepository,
  CategoryDetail,
  CategoryTreeNode,
  LocalisedCategory,
  LocalisedProduct,
  LocalisedProductDetail,
  LocalisedVariant,
  ProductAvailability,
  ProductImageRecord,
  ProductListFilters,
  ProductStoreSummary,
  VariantAvailability,
  VendorProduct,
} from './catalog.repository.types';
