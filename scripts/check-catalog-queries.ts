/* eslint-disable no-console */
import { closeDb, getDb } from '@/lib/db/client';
import { ADMIN_SCOPE } from '@/lib/db/repository';
import { createCatalogRepository } from '@/modules/catalog/catalog.repository';
import { createSearchProvider } from '@/modules/search/search.repository';

/**
 * Executes every public catalog and search query against a REAL PostgreSQL database.
 *
 * WHY THIS EXISTS: the unit suite runs against the in-memory repository, which
 * proves the semantics but never compiles a line of SQL. Drizzle type-checks the
 * builder, not the resulting statement — CTEs, `count(*) filter (...)`, row-wise
 * keyset comparisons and explicit casts can all typecheck and still fail in
 * Postgres. This is the only thing that catches that.
 *
 * Run via `scripts/db-integration-check.sh`, which provisions a throwaway database.
 * It reads DATABASE_URL and never touches a shared one.
 */

async function main(): Promise<void> {
  const db = await getDb();
  const repository = createCatalogRepository({ db });

  const failures: string[] = [];
  let checks = 0;

  async function check(name: string, run: () => Promise<unknown>): Promise<unknown> {
    checks += 1;
    try {
      const result = await run();
      console.log(`  ✅ ${name}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ ${name}\n     ${message}`);
      failures.push(`${name}: ${message}`);
      return undefined;
    }
  }

  console.log('\nCatalog queries against real PostgreSQL:\n');

  const tree = (await check('listCategoryTree(en)', () =>
    repository.listCategoryTree({ locale: 'en' })
  )) as Array<{ slug: string; children: unknown[] }> | undefined;

  await check('listCategoryTree(hi)', () => repository.listCategoryTree({ locale: 'hi' }));

  const category = (await check('findCategoryBySlug(staples)', () =>
    repository.findCategoryBySlug('staples', { locale: 'en' })
  )) as { id: string } | null | undefined;

  await check('findCategoryBySlug(child, ancestors)', () =>
    repository.findCategoryBySlug('fresh-fruits', { locale: 'hi' })
  );

  await check('listProducts(default sort)', () =>
    repository.listProducts({}, { locale: 'en' }, { limit: 5 })
  );

  // Each sort key exercises a different cast inside the keyset predicate.
  for (const sort of [
    'createdAt:desc',
    'createdAt:asc',
    'pricePaise:asc',
    'pricePaise:desc',
    'ratingAvg:desc',
    'soldCount:desc',
  ]) {
    await check(`listProducts(sort=${sort})`, () =>
      repository.listProducts({}, { locale: 'en' }, { limit: 2 }, sort)
    );
  }

  // Cursor pagination: the row-comparison predicate with an explicit cast is the
  // single most likely statement to fail only at runtime.
  for (const sort of ['createdAt:desc', 'pricePaise:asc', 'ratingAvg:desc', 'soldCount:desc']) {
    const firstPage = (await check(`listProducts page 1 (${sort})`, () =>
      repository.listProducts({}, { locale: 'en' }, { limit: 2 }, sort)
    )) as { nextCursor: string | null } | undefined;

    if (firstPage?.nextCursor) {
      await check(`listProducts page 2 via cursor (${sort})`, () =>
        repository.listProducts(
          {},
          { locale: 'en' },
          { limit: 2, cursor: firstPage.nextCursor! },
          sort
        )
      );
    }
  }

  await check('listProducts(inStockOnly)', () =>
    repository.listProducts({ inStockOnly: true }, { locale: 'en' }, { limit: 10 })
  );

  await check('listProducts(price range)', () =>
    repository.listProducts(
      { minPricePaise: 5_000, maxPricePaise: 30_000 },
      { locale: 'en' },
      { limit: 10 }
    )
  );

  await check('listProducts(search, both locales)', () =>
    repository.listProducts({ search: 'टमाटर' }, { locale: 'en' }, { limit: 10 })
  );

  if (category) {
    await check('listProducts(categoryIds)', () =>
      repository.listProducts({ categoryIds: [category.id] }, { locale: 'en' }, { limit: 10 })
    );
  }

  await check('listProducts(status filter)', () =>
    repository.listProducts({ status: 'ACTIVE' }, { locale: 'en' }, { limit: 10 })
  );

  await check('findProductBySlug', () =>
    repository.findProductBySlug('demo-atta-5kg', { locale: 'en' })
  );

  const detail = (await check('findProductDetailBySlug(en)', () =>
    repository.findProductDetailBySlug('demo-atta-5kg', { locale: 'en' })
  )) as { id: string; variants: unknown[] } | null | undefined;

  await check('findProductDetailBySlug(hi fallback)', () =>
    repository.findProductDetailBySlug('demo-cleaning-liquid-1l', { locale: 'hi' })
  );

  if (detail) {
    await check('getProductAvailability', () => repository.getProductAvailability(detail.id));
    await check('listRelatedProducts', () =>
      repository.listRelatedProducts(detail.id, { locale: 'en' }, 8)
    );
  }

  // Vendor and admin paths: these carry the inventory rollup CTE that replaced the
  // fan-out join, so they must be exercised too.
  await check('listAllProducts(admin)', () =>
    repository.listAllProducts(ADMIN_SCOPE, {}, { locale: 'en' }, { page: 1, pageSize: 10 })
  );

  await check('getTranslationCompleteness(hi)', () =>
    repository.getTranslationCompleteness(ADMIN_SCOPE, 'hi')
  );

  const vendorProduct = (await check('listAllProducts -> vendor scope probe', async () => {
    const all = await repository.listAllProducts(
      ADMIN_SCOPE,
      {},
      { locale: 'en' },
      { page: 1, pageSize: 1 }
    );
    return all.items[0];
  })) as { id: string } | undefined;

  if (vendorProduct) {
    // The vendor id is not exposed on the public shape, so this probes the
    // tenant-scoped paths using a scope that matches nothing — proving the query
    // compiles and returns empty rather than erroring.
    const emptyScope = { vendorId: '00000000-0000-4000-8000-000000000000' };

    await check('listVendorProducts(empty scope)', () =>
      repository.listVendorProducts(emptyScope, {}, { locale: 'en' }, { page: 1, pageSize: 5 })
    );
    await check('findVendorProductById(empty scope)', () =>
      repository.findVendorProductById(emptyScope, vendorProduct.id, { locale: 'en' })
    );
    await check('isProductOwnedByVendor(empty scope)', () =>
      repository.isProductOwnedByVendor(emptyScope, vendorProduct.id)
    );
    await check('countLowStockProducts(empty scope)', () =>
      repository.countLowStockProducts(emptyScope)
    );
  }

  // -------------------------------------------------------------------------
  // Search (decision D-21).
  //
  // These statements are raw SQL with a per-row `regconfig` cast, `ts_rank`,
  // `similarity()` and a UNION — none of which Drizzle can typecheck. This is the
  // only place PostgreSQL ever compiles them.
  // -------------------------------------------------------------------------
  console.log('\nSearch queries against real PostgreSQL:\n');

  const search = createSearchProvider({ db });

  // Both locales, because the text-search configuration is chosen PER ROW:
  // 'english' for en rows, 'simple' for everything else (clarification C-2).
  for (const locale of ['en', 'hi'] as const) {
    await check(`searchProducts(${locale}, plain term)`, () =>
      search.searchProducts({ term: 'atta', locale })
    );
    await check(`searchProducts(${locale}, multi-word)`, () =>
      search.searchProducts({ term: 'whole wheat', locale })
    );
    await check(`searchCategories(${locale})`, () => search.searchCategories('fresh', locale));
    await check(`suggest(${locale})`, () => search.suggest('de', locale));
  }

  // Devanagari, through the 'simple' configuration plus pg_trgm.
  await check('searchProducts(hi, devanagari)', () =>
    search.searchProducts({ term: 'टमाटर', locale: 'hi' })
  );
  await check('suggest(hi, devanagari)', () => search.suggest('डेमो', 'hi'));

  // websearch_to_tsquery must not raise on hostile input. That is exactly why it was
  // chosen over to_tsquery for a public search box.
  const hostileTerms = ['"unclosed quote', 'a & b | c', '-only', ':::', "o'brien", 'a\\b'];
  for (const term of hostileTerms) {
    await check(`searchProducts(hostile input: ${term})`, () =>
      search.searchProducts({ term, locale: 'en' })
    );
  }

  for (const sort of [
    'relevance',
    'pricePaise:asc',
    'pricePaise:desc',
    'createdAt:desc',
  ] as const) {
    await check(`searchProducts(sort=${sort})`, () =>
      search.searchProducts({ term: 'demo', locale: 'en', sort })
    );
  }

  await check('searchProducts(inStockOnly)', () =>
    search.searchProducts({ term: 'demo', locale: 'en', inStockOnly: true })
  );
  await check('searchProducts(price range)', () =>
    search.searchProducts({
      term: 'demo',
      locale: 'en',
      minPricePaise: 5_000,
      maxPricePaise: 30_000,
    })
  );

  if (category) {
    await check('searchProducts(categoryIds)', () =>
      search.searchProducts({ term: 'demo', locale: 'en', categoryIds: [category.id] })
    );
  }

  await check('searchProducts(pagination offset)', () =>
    search.searchProducts({ term: 'demo', locale: 'en', limit: 2, offset: 2 })
  );

  // A term matching nothing must return an empty set, not an error.
  const empty = (await check('searchProducts(no matches)', () =>
    search.searchProducts({ term: 'zzzznotathing', locale: 'en' })
  )) as { hits: unknown[]; total: number } | undefined;

  if (empty && (empty.hits.length !== 0 || empty.total !== 0)) {
    failures.push('searchProducts(no matches): expected an empty result set');
    console.log('  âŒ searchProducts(no matches) returned rows');
  }

  // Ranking must be meaningful, not merely non-erroring.
  const ranked = (await check('searchProducts(ranking is ordered)', () =>
    search.searchProducts({ term: 'Demo Tomatoes', locale: 'en' })
  )) as { hits: Array<{ score: number }> } | undefined;

  if (ranked && ranked.hits.length > 1) {
    const scores = ranked.hits.map((hit) => hit.score);
    const ordered = scores.every((score, index) => index === 0 || scores[index - 1]! >= score);
    if (!ordered) {
      failures.push('searchProducts: hits were not ordered by descending score');
      console.log('  âŒ search hits were not ordered by descending score');
    }
  }

  console.log(`\n${checks - failures.length}/${checks} queries executed successfully.`);

  if (tree) {
    console.log(`Categories in database: ${tree.length} roots.`);
  }

  await closeDb();

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} query check(s) failed.\n`);
    process.exit(1);
  }

  console.log('\n✅ All catalog and search SQL executes against PostgreSQL.\n');
}

main().catch(async (error: unknown) => {
  console.error('\n❌ Query check failed:', error instanceof Error ? error.message : error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
