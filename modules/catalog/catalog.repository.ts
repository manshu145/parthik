import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  categories,
  categoryTranslations,
  inventory,
  productImages,
  productTranslations,
  products,
} from '@/db/schema';
import { defaultLocale } from '@/i18n/routing';
import {
  resolveLimit,
  resolveOffsetPage,
  resolveSort,
  type AdminScope,
  type CursorPage,
  type CursorResult,
  type LocaleScope,
  type OffsetPage,
  type OffsetResult,
  type RepositoryContext,
  type VendorScope,
} from '@/lib/db/repository';
import {
  PRODUCT_SORT_KEYS,
  type CatalogRepository,
  type LocalisedProduct,
  type ProductListFilters,
  type ProductSortKey,
  type TranslationCompleteness,
  type VendorProduct,
} from './catalog.repository.types';

/**
 * Catalog repository — the REFERENCE IMPLEMENTATION for this codebase.
 *
 * It exists to demonstrate, in one place, the four things every other repository
 * must also do:
 *
 *   1. TENANT ISOLATION. Vendor methods put `vendor_id` in the WHERE clause. A
 *      caller cannot ask for another vendor's row even by passing its id.
 *   2. SOFT-DELETE FILTERING. `deleted_at IS NULL` is applied by default.
 *   3. LOCALE FALLBACK. Translated fields COALESCE from the requested locale to
 *      English in a single query, so call sites cannot forget it (D-33).
 *   4. BOUNDED READS. Page size is clamped and sort keys are allowlisted.
 *
 * This file is the only kind of file permitted to import `@/db/schema` — enforced
 * by the ESLint import-boundary rules.
 */

/** Columns a customer-facing surface may see. Excludes vendor-private cost. */
const publicProductColumns = {
  id: products.id,
  slug: products.slug,
  status: products.status,
  mrpPaise: products.mrpPaise,
  pricePaise: products.pricePaise,
  ratingAvg: products.ratingAvg,
  ratingCount: products.ratingCount,
  categoryId: products.categoryId,
  storeId: products.storeId,
};

export class DrizzleCatalogRepository implements CatalogRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  // -------------------------------------------------------------------------
  // Locale resolution
  // -------------------------------------------------------------------------

  /** Discount percent, or null when there is no real discount to advertise. */
  private discountPercent(mrpPaise: number, pricePaise: number): number | null {
    if (mrpPaise <= 0 || pricePaise >= mrpPaise) return null;
    return Math.round(((mrpPaise - pricePaise) / mrpPaise) * 100);
  }

  // -------------------------------------------------------------------------
  // Public (customer-facing) reads
  // -------------------------------------------------------------------------

  async findProductBySlug(slug: string, locale: LocaleScope): Promise<LocalisedProduct | null> {
    const requested = this.ctx.db.$with('t_req').as(
      this.ctx.db
        .select({
          productId: productTranslations.productId,
          name: productTranslations.name,
          shortDescription: productTranslations.shortDescription,
          unitLabel: productTranslations.unitLabel,
        })
        .from(productTranslations)
        .where(eq(productTranslations.locale, locale.locale))
    );

    const fallback = this.ctx.db.$with('t_fb').as(
      this.ctx.db
        .select({
          productId: productTranslations.productId,
          name: productTranslations.name,
          shortDescription: productTranslations.shortDescription,
          unitLabel: productTranslations.unitLabel,
        })
        .from(productTranslations)
        .where(eq(productTranslations.locale, defaultLocale))
    );

    const rows = await this.ctx.db
      .with(requested, fallback)
      .select({
        ...publicProductColumns,
        name: sql<string>`coalesce(${requested.name}, ${fallback.name})`,
        shortDescription: sql<
          string | null
        >`coalesce(${requested.shortDescription}, ${fallback.shortDescription})`,
        unitLabel: sql<string | null>`coalesce(${requested.unitLabel}, ${products.unitLabel})`,
        usedFallbackLocale: sql<boolean>`${requested.name} is null`,
        primaryImageKey: productImages.storageKey,
        primaryImageAlt: productImages.altText,
      })
      .from(products)
      .leftJoin(requested, eq(requested.productId, products.id))
      .leftJoin(fallback, eq(fallback.productId, products.id))
      .leftJoin(
        productImages,
        and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true))
      )
      .where(
        and(
          eq(products.slug, slug),
          // Public surfaces see ACTIVE products only.
          eq(products.status, 'ACTIVE'),
          isNull(products.deletedAt)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      ...row,
      discountPercent: this.discountPercent(row.mrpPaise, row.pricePaise),
    };
  }

  async listProducts(
    filters: ProductListFilters,
    locale: LocaleScope,
    page: CursorPage,
    sort?: string
  ): Promise<CursorResult<LocalisedProduct>> {
    const limit = resolveLimit(page.limit);
    const { key, direction } = resolveSort<ProductSortKey>(sort, PRODUCT_SORT_KEYS, 'createdAt');

    const conditions: SQL[] = [
      eq(products.status, 'ACTIVE'),
      isNull(products.deletedAt),
      ...this.buildFilterConditions(filters),
    ];

    // Cursor is the opaque encoding of the last row's sort value plus its id, so
    // pagination is stable even when two rows share a sort value.
    if (page.cursor) {
      const decoded = decodeCursor(page.cursor);
      if (decoded) {
        conditions.push(
          direction === 'desc'
            ? sql`(${products.createdAt}, ${products.id}) < (${decoded.value}, ${decoded.id})`
            : sql`(${products.createdAt}, ${products.id}) > (${decoded.value}, ${decoded.id})`
        );
      }
    }

    const requested = this.translationSubquery(locale.locale);
    const fallback = this.translationSubquery(defaultLocale);

    const orderColumn = this.sortColumn(key);

    const rows = await this.ctx.db
      .with(requested, fallback)
      .select({
        ...publicProductColumns,
        createdAt: products.createdAt,
        name: sql<string>`coalesce(${requested.name}, ${fallback.name})`,
        shortDescription: sql<
          string | null
        >`coalesce(${requested.shortDescription}, ${fallback.shortDescription})`,
        unitLabel: sql<string | null>`coalesce(${requested.unitLabel}, ${products.unitLabel})`,
        usedFallbackLocale: sql<boolean>`${requested.name} is null`,
        primaryImageKey: productImages.storageKey,
        primaryImageAlt: productImages.altText,
      })
      .from(products)
      .leftJoin(requested, eq(requested.productId, products.id))
      .leftJoin(fallback, eq(fallback.productId, products.id))
      .leftJoin(
        productImages,
        and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true))
      )
      .where(and(...conditions))
      // Always tie-break on id: without it, equal sort values can repeat or skip
      // rows across pages.
      .orderBy(
        direction === 'desc' ? desc(orderColumn) : asc(orderColumn),
        direction === 'desc' ? desc(products.id) : asc(products.id)
      )
      // Fetch one extra row to determine hasMore without a second count query.
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      shortDescription: row.shortDescription,
      unitLabel: row.unitLabel,
      status: row.status,
      mrpPaise: row.mrpPaise,
      pricePaise: row.pricePaise,
      discountPercent: this.discountPercent(row.mrpPaise, row.pricePaise),
      ratingAvg: row.ratingAvg,
      ratingCount: row.ratingCount,
      primaryImageKey: row.primaryImageKey,
      primaryImageAlt: row.primaryImageAlt,
      categoryId: row.categoryId,
      storeId: row.storeId,
      usedFallbackLocale: row.usedFallbackLocale,
    }));

    const last = hasMore ? rows[limit - 1] : undefined;

    return {
      items,
      nextCursor: last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
      hasMore,
    };
  }

  // -------------------------------------------------------------------------
  // Vendor reads — TENANT ISOLATED
  // -------------------------------------------------------------------------

  /**
   * Every vendor query starts from this predicate.
   *
   * `scope.vendorId` comes from the session, never from client input, and it is
   * ALWAYS in the WHERE clause — that is what makes cross-tenant access
   * structurally impossible rather than merely against the rules.
   */
  private vendorPredicate(scope: VendorScope): SQL[] {
    const conditions: SQL[] = [eq(products.vendorId, scope.vendorId), isNull(products.deletedAt)];
    if (scope.storeId) conditions.push(eq(products.storeId, scope.storeId));
    return conditions;
  }

  async listVendorProducts(
    scope: VendorScope,
    filters: ProductListFilters,
    locale: LocaleScope,
    page: OffsetPage,
    sort?: string
  ): Promise<OffsetResult<VendorProduct>> {
    const { limit, offset, page: currentPage } = resolveOffsetPage(page);
    const { key, direction } = resolveSort<ProductSortKey>(sort, PRODUCT_SORT_KEYS, 'createdAt');

    const conditions = [...this.vendorPredicate(scope), ...this.buildFilterConditions(filters)];

    const requested = this.translationSubquery(locale.locale);
    const fallback = this.translationSubquery(defaultLocale);
    const orderColumn = this.sortColumn(key);

    const [rows, totals] = await Promise.all([
      this.ctx.db
        .with(requested, fallback)
        .select({
          ...publicProductColumns,
          // Vendor-private: visible to the owning vendor only.
          costPaise: products.costPaise,
          version: products.version,
          publishedAt: products.publishedAt,
          name: sql<string>`coalesce(${requested.name}, ${fallback.name})`,
          shortDescription: sql<
            string | null
          >`coalesce(${requested.shortDescription}, ${fallback.shortDescription})`,
          unitLabel: sql<string | null>`coalesce(${requested.unitLabel}, ${products.unitLabel})`,
          usedFallbackLocale: sql<boolean>`${requested.name} is null`,
          primaryImageKey: productImages.storageKey,
          primaryImageAlt: productImages.altText,
          quantityAvailable: inventory.quantityAvailable,
          quantityReserved: inventory.quantityReserved,
          lowStockThreshold: inventory.lowStockThreshold,
          trackInventory: inventory.trackInventory,
        })
        .from(products)
        .leftJoin(requested, eq(requested.productId, products.id))
        .leftJoin(fallback, eq(fallback.productId, products.id))
        .leftJoin(
          productImages,
          and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true))
        )
        .leftJoin(inventory, eq(inventory.storeId, products.storeId))
        .where(and(...conditions))
        .orderBy(direction === 'desc' ? desc(orderColumn) : asc(orderColumn), desc(products.id))
        .limit(limit)
        .offset(offset),

      this.ctx.db
        .select({ value: count() })
        .from(products)
        .where(and(...conditions)),
    ]);

    const total = Number(totals[0]?.value ?? 0);

    return {
      items: rows.map((row) => ({
        ...row,
        discountPercent: this.discountPercent(row.mrpPaise, row.pricePaise),
      })),
      page: currentPage,
      pageSize: limit,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  async findVendorProductById(
    scope: VendorScope,
    productId: string,
    locale: LocaleScope
  ): Promise<VendorProduct | null> {
    // Queried narrowly so the vendor predicate and the id predicate are enforced
    // together by the database, in one statement.
    const requested = this.translationSubquery(locale.locale);
    const fallback = this.translationSubquery(defaultLocale);

    const rows = await this.ctx.db
      .with(requested, fallback)
      .select({
        ...publicProductColumns,
        costPaise: products.costPaise,
        version: products.version,
        publishedAt: products.publishedAt,
        name: sql<string>`coalesce(${requested.name}, ${fallback.name})`,
        shortDescription: sql<
          string | null
        >`coalesce(${requested.shortDescription}, ${fallback.shortDescription})`,
        unitLabel: sql<string | null>`coalesce(${requested.unitLabel}, ${products.unitLabel})`,
        usedFallbackLocale: sql<boolean>`${requested.name} is null`,
        primaryImageKey: productImages.storageKey,
        primaryImageAlt: productImages.altText,
        quantityAvailable: inventory.quantityAvailable,
        quantityReserved: inventory.quantityReserved,
        lowStockThreshold: inventory.lowStockThreshold,
        trackInventory: inventory.trackInventory,
      })
      .from(products)
      .leftJoin(requested, eq(requested.productId, products.id))
      .leftJoin(fallback, eq(fallback.productId, products.id))
      .leftJoin(
        productImages,
        and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true))
      )
      .leftJoin(inventory, eq(inventory.storeId, products.storeId))
      .where(and(eq(products.id, productId), ...this.vendorPredicate(scope)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return { ...row, discountPercent: this.discountPercent(row.mrpPaise, row.pricePaise) };
  }

  /**
   * Ownership proven from the database before any mutation.
   *
   * Returns false — rather than throwing — so the caller can decide between 404
   * and 403. Per docs/SECURITY.md §5.4 the service returns 404 to avoid leaking
   * whether the id exists at all.
   */
  async isProductOwnedByVendor(scope: VendorScope, productId: string): Promise<boolean> {
    const rows = await this.ctx.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), ...this.vendorPredicate(scope)))
      .limit(1);

    return rows.length > 0;
  }

  async countLowStockProducts(scope: VendorScope): Promise<number> {
    const rows = await this.ctx.db
      .select({ value: count() })
      .from(products)
      .innerJoin(inventory, eq(inventory.storeId, products.storeId))
      .where(
        and(
          ...this.vendorPredicate(scope),
          eq(inventory.trackInventory, true),
          sql`${inventory.quantityAvailable} <= ${inventory.lowStockThreshold}`
        )
      );

    return Number(rows[0]?.value ?? 0);
  }

  // -------------------------------------------------------------------------
  // Admin reads
  // -------------------------------------------------------------------------

  async listAllProducts(
    scope: AdminScope,
    filters: ProductListFilters,
    locale: LocaleScope,
    page: OffsetPage,
    sort?: string
  ): Promise<OffsetResult<VendorProduct>> {
    void scope;
    const { limit, offset, page: currentPage } = resolveOffsetPage(page);
    const { key, direction } = resolveSort<ProductSortKey>(sort, PRODUCT_SORT_KEYS, 'createdAt');

    // Admin sees every vendor, but still not soft-deleted rows by default.
    const conditions = [isNull(products.deletedAt), ...this.buildFilterConditions(filters)];

    const requested = this.translationSubquery(locale.locale);
    const fallback = this.translationSubquery(defaultLocale);
    const orderColumn = this.sortColumn(key);

    const [rows, totals] = await Promise.all([
      this.ctx.db
        .with(requested, fallback)
        .select({
          ...publicProductColumns,
          costPaise: products.costPaise,
          version: products.version,
          publishedAt: products.publishedAt,
          name: sql<string>`coalesce(${requested.name}, ${fallback.name})`,
          shortDescription: sql<
            string | null
          >`coalesce(${requested.shortDescription}, ${fallback.shortDescription})`,
          unitLabel: sql<string | null>`coalesce(${requested.unitLabel}, ${products.unitLabel})`,
          usedFallbackLocale: sql<boolean>`${requested.name} is null`,
          primaryImageKey: productImages.storageKey,
          primaryImageAlt: productImages.altText,
          quantityAvailable: inventory.quantityAvailable,
          quantityReserved: inventory.quantityReserved,
          lowStockThreshold: inventory.lowStockThreshold,
          trackInventory: inventory.trackInventory,
        })
        .from(products)
        .leftJoin(requested, eq(requested.productId, products.id))
        .leftJoin(fallback, eq(fallback.productId, products.id))
        .leftJoin(
          productImages,
          and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true))
        )
        .leftJoin(inventory, eq(inventory.storeId, products.storeId))
        .where(and(...conditions))
        .orderBy(direction === 'desc' ? desc(orderColumn) : asc(orderColumn), desc(products.id))
        .limit(limit)
        .offset(offset),

      this.ctx.db
        .select({ value: count() })
        .from(products)
        .where(and(...conditions)),
    ]);

    const total = Number(totals[0]?.value ?? 0);

    return {
      items: rows.map((row) => ({
        ...row,
        discountPercent: this.discountPercent(row.mrpPaise, row.pricePaise),
      })),
      page: currentPage,
      pageSize: limit,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  /**
   * Translation completeness (D-33).
   *
   * Makes gaps queryable so admin can see what is untranslated, rather than
   * discovering it from a customer seeing English text on a Hindi page.
   */
  async getTranslationCompleteness(
    scope: AdminScope,
    locale: string
  ): Promise<TranslationCompleteness[]> {
    void scope;

    const [productStats, categoryStats] = await Promise.all([
      this.ctx.db
        .select({
          total: count(),
          translated: sql<number>`count(${productTranslations.id})`,
        })
        .from(products)
        .leftJoin(
          productTranslations,
          and(
            eq(productTranslations.productId, products.id),
            eq(productTranslations.locale, locale as 'en' | 'hi')
          )
        )
        .where(isNull(products.deletedAt)),

      this.ctx.db
        .select({
          total: count(),
          translated: sql<number>`count(${categoryTranslations.id})`,
        })
        .from(categories)
        .leftJoin(
          categoryTranslations,
          and(
            eq(categoryTranslations.categoryId, categories.id),
            eq(categoryTranslations.locale, locale as 'en' | 'hi')
          )
        )
        .where(isNull(categories.deletedAt)),
    ]);

    return [
      buildCompleteness('products', locale, productStats[0]),
      buildCompleteness('categories', locale, categoryStats[0]),
    ];
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  /** One reusable translation CTE per locale, so joins stay identical everywhere. */
  private translationSubquery(locale: 'en' | 'hi') {
    return this.ctx.db.$with(`t_${locale}`).as(
      this.ctx.db
        .select({
          productId: productTranslations.productId,
          name: productTranslations.name,
          shortDescription: productTranslations.shortDescription,
          unitLabel: productTranslations.unitLabel,
        })
        .from(productTranslations)
        .where(eq(productTranslations.locale, locale))
    );
  }

  private sortColumn(key: ProductSortKey) {
    switch (key) {
      case 'pricePaise':
        return products.pricePaise;
      case 'ratingAvg':
        return products.ratingAvg;
      case 'soldCount':
        return products.soldCount;
      case 'createdAt':
      default:
        return products.createdAt;
    }
  }

  /** Filters are built from named parameters only — never raw client SQL. */
  private buildFilterConditions(filters: ProductListFilters): SQL[] {
    const conditions: SQL[] = [];

    if (filters.categoryId) conditions.push(eq(products.categoryId, filters.categoryId));
    if (filters.brandId) conditions.push(eq(products.brandId, filters.brandId));
    if (filters.minPricePaise !== undefined) {
      conditions.push(gte(products.pricePaise, filters.minPricePaise));
    }
    if (filters.maxPricePaise !== undefined) {
      conditions.push(lte(products.pricePaise, filters.maxPricePaise));
    }
    if (filters.search) {
      // Trigram-backed match on the translated name, covering both locales.
      const term = `%${filters.search}%`;
      const match = or(
        ilike(productTranslations.name, term),
        ilike(productTranslations.shortDescription, term)
      );
      if (match) {
        conditions.push(
          sql`exists (
            select 1 from ${productTranslations}
            where ${productTranslations.productId} = ${products.id} and ${match}
          )`
        );
      }
    }

    return conditions;
  }
}

function buildCompleteness(
  entity: string,
  locale: string,
  stats: { total: number; translated: number } | undefined
): TranslationCompleteness {
  const total = Number(stats?.total ?? 0);
  const translated = Number(stats?.translated ?? 0);
  return { entity, locale, total, translated, missing: Math.max(0, total - translated) };
}

/**
 * Opaque cursors. Base64 keeps clients from treating them as meaningful values and
 * building a dependency on our sort implementation.
 */
function encodeCursor(value: string, id: string): string {
  return Buffer.from(`${value}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { value: string; id: string } | null {
  try {
    const [value, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!value || !id) return null;
    return { value, id };
  } catch {
    return null;
  }
}

/** Factory used by the service layer, which never constructs the class directly. */
export function createCatalogRepository(ctx: RepositoryContext): CatalogRepository {
  return new DrizzleCatalogRepository(ctx);
}
