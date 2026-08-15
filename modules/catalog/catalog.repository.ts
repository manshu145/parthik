import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  brandTranslations,
  categories,
  categoryTranslations,
  inventory,
  productImages,
  productTranslations,
  productVariantTranslations,
  productVariants,
  products,
  seoMetaTranslations,
  stores,
} from '@/db/schema';
import { defaultLocale, type Locale } from '@/i18n/routing';
import { decodeCursor, encodeCursor } from '@/lib/db/cursor';
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
  type CategoryDetail,
  type CategoryTreeNode,
  type LocalisedCategory,
  type LocalisedProduct,
  type LocalisedProductDetail,
  type LocalisedVariant,
  type ProductAvailability,
  type ProductImageRecord,
  type ProductListFilters,
  type ProductSortKey,
  type PurchasableVariant,
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
 *
 * TWO JOIN STYLES APPEAR HERE, deliberately:
 *   - Product translations use CTEs (`$with`), the original TASK 002 pattern.
 *   - Newer joins (categories, variants, brands, SEO) use `alias()`, which is
 *     shorter and reads better for a simple two-locale LEFT JOIN.
 * The existing product queries were left on CTEs rather than churned, since they
 * are correct and covered.
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

/**
 * Whether one variant can be sold right now.
 *
 * A variant with NO inventory row counts as OUT of stock. That is the
 * conservative direction on purpose: hiding an "Add" button on a product we
 * cannot confirm is far cheaper than accepting money for stock that does not
 * exist. Untracked inventory (`track_inventory = false`) is always sellable.
 */
function variantInStock(quantityAvailable: number | null, trackInventory: boolean | null): boolean {
  if (trackInventory === null) return false;
  if (!trackInventory) return true;
  return (quantityAvailable ?? 0) > 0;
}

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

  /**
   * Per-product inventory rollup.
   *
   * ⚠️ THIS REPLACES A REAL BUG. The previous code joined
   * `inventory ON inventory.store_id = products.store_id`, but `inventory` is
   * unique per VARIANT (`inventory_variant_key`), so that join matched every
   * inventory row in the store and multiplied each product row by the store's
   * variant count — inflating list totals and attributing arbitrary stock
   * numbers to unrelated products.
   *
   * Aggregating through `product_variants` gives exactly one row per product.
   */
  private inventorySummary() {
    return this.ctx.db.$with('inv').as(
      this.ctx.db
        .select({
          productId: productVariants.productId,
          quantityAvailable: sql<number>`coalesce(sum(${inventory.quantityAvailable}), 0)::int`.as(
            'quantity_available'
          ),
          quantityReserved: sql<number>`coalesce(sum(${inventory.quantityReserved}), 0)::int`.as(
            'quantity_reserved'
          ),
          lowStockThreshold: sql<number>`coalesce(min(${inventory.lowStockThreshold}), 0)::int`.as(
            'low_stock_threshold'
          ),
          trackInventory: sql<boolean>`bool_or(${inventory.trackInventory})`.as('track_inventory'),
          /** Number of variants that could be sold right now. */
          sellableVariants: sql<number>`count(*) filter (
            where ${inventory.trackInventory} = false or ${inventory.quantityAvailable} > 0
          )::int`.as('sellable_variants'),
        })
        .from(productVariants)
        .innerJoin(inventory, eq(inventory.variantId, productVariants.id))
        .where(and(isNull(productVariants.deletedAt), eq(productVariants.isActive, true)))
        .groupBy(productVariants.productId)
    );
  }

  // -------------------------------------------------------------------------
  // Public (customer-facing) reads
  // -------------------------------------------------------------------------

  async findProductBySlug(slug: string, locale: LocaleScope): Promise<LocalisedProduct | null> {
    const requested = this.translationSubquery(locale.locale, 't_req');
    const fallback = this.translationSubquery(defaultLocale, 't_fb');
    const inv = this.inventorySummary();

    const rows = await this.ctx.db
      .with(requested, fallback, inv)
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
        sellableVariants: inv.sellableVariants,
      })
      .from(products)
      .leftJoin(requested, eq(requested.productId, products.id))
      .leftJoin(fallback, eq(fallback.productId, products.id))
      .leftJoin(
        productImages,
        and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true))
      )
      .leftJoin(inv, eq(inv.productId, products.id))
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

    const { sellableVariants, ...rest } = row;

    return {
      ...rest,
      discountPercent: this.discountPercent(row.mrpPaise, row.pricePaise),
      inStock: (sellableVariants ?? 0) > 0,
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
    // pagination is stable even when two rows share a sort value. The comparison
    // uses the SAME column being ordered by — see lib/db/cursor.ts.
    if (page.cursor) {
      const decoded = decodeCursor(page.cursor, key);
      if (decoded) {
        conditions.push(this.cursorPredicate(key, direction, decoded.value, decoded.id));
      }
    }

    const requested = this.translationSubquery(locale.locale, 't_req');
    const fallback = this.translationSubquery(defaultLocale, 't_fb');
    const inv = this.inventorySummary();

    const orderColumn = this.sortColumn(key);

    const rows = await this.ctx.db
      .with(requested, fallback, inv)
      .select({
        ...publicProductColumns,
        createdAt: products.createdAt,
        soldCount: products.soldCount,
        name: sql<string>`coalesce(${requested.name}, ${fallback.name})`,
        shortDescription: sql<
          string | null
        >`coalesce(${requested.shortDescription}, ${fallback.shortDescription})`,
        unitLabel: sql<string | null>`coalesce(${requested.unitLabel}, ${products.unitLabel})`,
        usedFallbackLocale: sql<boolean>`${requested.name} is null`,
        primaryImageKey: productImages.storageKey,
        primaryImageAlt: productImages.altText,
        sellableVariants: inv.sellableVariants,
      })
      .from(products)
      .leftJoin(requested, eq(requested.productId, products.id))
      .leftJoin(fallback, eq(fallback.productId, products.id))
      .leftJoin(
        productImages,
        and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true))
      )
      .leftJoin(inv, eq(inv.productId, products.id))
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
      inStock: (row.sellableVariants ?? 0) > 0,
      usedFallbackLocale: row.usedFallbackLocale,
    }));

    const last = hasMore ? rows[limit - 1] : undefined;

    return {
      items,
      nextCursor: last ? encodeCursor(key, this.cursorValue(key, last), last.id) : null,
      hasMore,
    };
  }

  async listCategoryTree(locale: LocaleScope): Promise<CategoryTreeNode[]> {
    const rows = await this.selectCategories(locale.locale, [
      eq(categories.isActive, true),
      isNull(categories.deletedAt),
    ]);

    const roots = rows.filter((row) => row.parentId === null);
    const byParent = new Map<string, LocalisedCategory[]>();

    for (const row of rows) {
      if (row.parentId === null) continue;
      const siblings = byParent.get(row.parentId) ?? [];
      siblings.push(row);
      byParent.set(row.parentId, siblings);
    }

    return roots.map((root) => ({ ...root, children: byParent.get(root.id) ?? [] }));
  }

  async findCategoryBySlug(slug: string, locale: LocaleScope): Promise<CategoryDetail | null> {
    const seoRequested = alias(seoMetaTranslations, 'seo_req');
    const seoFallback = alias(seoMetaTranslations, 'seo_fb');
    const translationRequested = alias(categoryTranslations, 'ct_req');
    const translationFallback = alias(categoryTranslations, 'ct_fb');

    const rows = await this.ctx.db
      .select({
        id: categories.id,
        slug: categories.slug,
        parentId: categories.parentId,
        iconKey: categories.iconKey,
        imageKey: categories.imageKey,
        displayOrder: categories.displayOrder,
        isFeatured: categories.isFeatured,
        name: sql<string>`coalesce(${translationRequested.name}, ${translationFallback.name})`,
        description: sql<
          string | null
        >`coalesce(${translationRequested.description}, ${translationFallback.description})`,
        usedFallbackLocale: sql<boolean>`${translationRequested.name} is null`,
        metaTitle: sql<
          string | null
        >`coalesce(${seoRequested.metaTitle}, ${seoFallback.metaTitle})`,
        metaDescription: sql<
          string | null
        >`coalesce(${seoRequested.metaDescription}, ${seoFallback.metaDescription})`,
      })
      .from(categories)
      .leftJoin(
        translationRequested,
        and(
          eq(translationRequested.categoryId, categories.id),
          eq(translationRequested.locale, locale.locale)
        )
      )
      .leftJoin(
        translationFallback,
        and(
          eq(translationFallback.categoryId, categories.id),
          eq(translationFallback.locale, defaultLocale)
        )
      )
      .leftJoin(
        seoRequested,
        and(
          eq(seoRequested.seoMetaId, categories.seoMetaId),
          eq(seoRequested.locale, locale.locale)
        )
      )
      .leftJoin(
        seoFallback,
        and(eq(seoFallback.seoMetaId, categories.seoMetaId), eq(seoFallback.locale, defaultLocale))
      )
      .where(
        and(eq(categories.slug, slug), eq(categories.isActive, true), isNull(categories.deletedAt))
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const [children, ancestors] = await Promise.all([
      this.selectCategories(locale.locale, [
        eq(categories.parentId, row.id),
        eq(categories.isActive, true),
        isNull(categories.deletedAt),
      ]),
      row.parentId
        ? this.selectCategories(locale.locale, [
            eq(categories.id, row.parentId),
            isNull(categories.deletedAt),
          ])
        : Promise.resolve([]),
    ]);

    return {
      ...row,
      children,
      // The tree is 2 deep by rule, so there is at most one ancestor.
      ancestors: ancestors.map((parent) => ({
        id: parent.id,
        slug: parent.slug,
        name: parent.name,
      })),
    };
  }

  async findProductDetailBySlug(
    slug: string,
    locale: LocaleScope
  ): Promise<LocalisedProductDetail | null> {
    const translationRequested = alias(productTranslations, 'pt_req');
    const translationFallback = alias(productTranslations, 'pt_fb');
    const categoryRequested = alias(categoryTranslations, 'ct_req');
    const categoryFallback = alias(categoryTranslations, 'ct_fb');
    const brandRequested = alias(brandTranslations, 'bt_req');
    const brandFallback = alias(brandTranslations, 'bt_fb');
    const seoRequested = alias(seoMetaTranslations, 'seo_req');
    const seoFallback = alias(seoMetaTranslations, 'seo_fb');

    const rows = await this.ctx.db
      .select({
        ...publicProductColumns,
        name: sql<string>`coalesce(${translationRequested.name}, ${translationFallback.name})`,
        shortDescription: sql<
          string | null
        >`coalesce(${translationRequested.shortDescription}, ${translationFallback.shortDescription})`,
        description: sql<
          string | null
        >`coalesce(${translationRequested.description}, ${translationFallback.description})`,
        specifications: sql<unknown>`coalesce(${translationRequested.specifications}, ${translationFallback.specifications})`,
        unitLabel: sql<
          string | null
        >`coalesce(${translationRequested.unitLabel}, ${products.unitLabel})`,
        usedFallbackLocale: sql<boolean>`${translationRequested.name} is null`,
        metaTitle: sql<
          string | null
        >`coalesce(${seoRequested.metaTitle}, ${seoFallback.metaTitle})`,
        metaDescription: sql<
          string | null
        >`coalesce(${seoRequested.metaDescription}, ${seoFallback.metaDescription})`,
        categorySlug: categories.slug,
        categoryName: sql<string>`coalesce(${categoryRequested.name}, ${categoryFallback.name})`,
        brandName: sql<string | null>`coalesce(${brandRequested.name}, ${brandFallback.name})`,
        storeSlug: stores.slug,
        storeName: stores.name,
        storeCity: stores.city,
        storePincode: stores.pincode,
        storeCodEnabled: stores.codEnabled,
        storePrepMinutes: stores.avgPrepTimeMinutes,
        storeStatus: stores.status,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .innerJoin(stores, eq(stores.id, products.storeId))
      .leftJoin(
        translationRequested,
        and(
          eq(translationRequested.productId, products.id),
          eq(translationRequested.locale, locale.locale)
        )
      )
      .leftJoin(
        translationFallback,
        and(
          eq(translationFallback.productId, products.id),
          eq(translationFallback.locale, defaultLocale)
        )
      )
      .leftJoin(
        categoryRequested,
        and(
          eq(categoryRequested.categoryId, categories.id),
          eq(categoryRequested.locale, locale.locale)
        )
      )
      .leftJoin(
        categoryFallback,
        and(
          eq(categoryFallback.categoryId, categories.id),
          eq(categoryFallback.locale, defaultLocale)
        )
      )
      .leftJoin(
        brandRequested,
        and(eq(brandRequested.brandId, products.brandId), eq(brandRequested.locale, locale.locale))
      )
      .leftJoin(
        brandFallback,
        and(eq(brandFallback.brandId, products.brandId), eq(brandFallback.locale, defaultLocale))
      )
      .leftJoin(
        seoRequested,
        and(eq(seoRequested.seoMetaId, products.seoMetaId), eq(seoRequested.locale, locale.locale))
      )
      .leftJoin(
        seoFallback,
        and(eq(seoFallback.seoMetaId, products.seoMetaId), eq(seoFallback.locale, defaultLocale))
      )
      .where(
        and(eq(products.slug, slug), eq(products.status, 'ACTIVE'), isNull(products.deletedAt))
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    // Images and variants are fetched separately rather than joined: joining both
    // would multiply the product row by images × variants and force de-duplication
    // in TS, which is exactly the kind of quiet correctness bug worth avoiding.
    const [images, variants] = await Promise.all([
      this.listProductImages(row.id),
      this.listProductVariants(row.id, locale.locale),
    ]);

    const primary = images.find((image) => image.isPrimary) ?? images[0] ?? null;

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      shortDescription: row.shortDescription,
      description: row.description,
      specifications: row.specifications ?? null,
      unitLabel: row.unitLabel,
      status: row.status,
      mrpPaise: row.mrpPaise,
      pricePaise: row.pricePaise,
      discountPercent: this.discountPercent(row.mrpPaise, row.pricePaise),
      ratingAvg: row.ratingAvg,
      ratingCount: row.ratingCount,
      primaryImageKey: primary?.storageKey ?? null,
      primaryImageAlt: primary?.altText ?? null,
      categoryId: row.categoryId,
      storeId: row.storeId,
      inStock: variants.some((variant) => variant.inStock),
      usedFallbackLocale: row.usedFallbackLocale,
      images,
      variants,
      store: {
        id: row.storeId,
        slug: row.storeSlug,
        name: row.storeName,
        city: row.storeCity,
        pincode: row.storePincode,
        codEnabled: row.storeCodEnabled,
        avgPrepTimeMinutes: row.storePrepMinutes,
        status: row.storeStatus,
      },
      categorySlug: row.categorySlug,
      categoryName: row.categoryName,
      brandName: row.brandName,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
    };
  }

  async getProductAvailability(productId: string): Promise<ProductAvailability | null> {
    const rows = await this.ctx.db
      .select({
        variantId: productVariants.id,
        isDefault: productVariants.isDefault,
        displayOrder: productVariants.displayOrder,
        pricePaise: productVariants.pricePaise,
        mrpPaise: productVariants.mrpPaise,
        quantityAvailable: inventory.quantityAvailable,
        trackInventory: inventory.trackInventory,
        productStatus: products.status,
        productDeletedAt: products.deletedAt,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(
        and(
          eq(productVariants.productId, productId),
          eq(productVariants.isActive, true),
          isNull(productVariants.deletedAt)
        )
      )
      .orderBy(desc(productVariants.isDefault), asc(productVariants.displayOrder));

    const first = rows[0];
    if (!first) return null;

    const isPublished = first.productStatus === 'ACTIVE' && first.productDeletedAt === null;

    const variants = rows.map((row) => ({
      variantId: row.variantId,
      isDefault: row.isDefault,
      pricePaise: row.pricePaise,
      mrpPaise: row.mrpPaise,
      quantityAvailable: row.quantityAvailable,
      trackInventory: row.trackInventory ?? false,
      inStock: variantInStock(row.quantityAvailable, row.trackInventory),
    }));

    return {
      productId,
      isPublished,
      // An unpublished product is never purchasable, whatever its stock says.
      inStock: isPublished && variants.some((variant) => variant.inStock),
      variants,
    };
  }

  async findPurchasableVariant(
    variantId: string,
    locale: LocaleScope
  ): Promise<PurchasableVariant | null> {
    const translationRequested = alias(productTranslations, 'pt_req');
    const translationFallback = alias(productTranslations, 'pt_fb');
    const variantRequested = alias(productVariantTranslations, 'vt_req');
    const variantFallback = alias(productVariantTranslations, 'vt_fb');

    const rows = await this.ctx.db
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productSlug: products.slug,
        storeId: products.storeId,
        vendorId: products.vendorId,
        categoryId: products.categoryId,
        productName: sql<string>`coalesce(${translationRequested.name}, ${translationFallback.name})`,
        variantLabel: sql<
          string | null
        >`coalesce(${variantRequested.variantLabel}, ${variantFallback.variantLabel})`,
        unitLabel: sql<
          string | null
        >`coalesce(${productVariants.unitLabel}, ${products.unitLabel})`,
        imageKey: productImages.storageKey,
        // Variant price wins over the product price: the variant is what is sold.
        pricePaise: productVariants.pricePaise,
        mrpPaise: productVariants.mrpPaise,
        productStatus: products.status,
        productDeletedAt: products.deletedAt,
        variantActive: productVariants.isActive,
        variantDeletedAt: productVariants.deletedAt,
        quantityAvailable: inventory.quantityAvailable,
        trackInventory: inventory.trackInventory,
        storeAcceptingOrders: stores.isAcceptingOrders,
        storeStatus: stores.status,
        storeMinOrderPaise: stores.minOrderPaise,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(stores, eq(stores.id, products.storeId))
      .leftJoin(
        translationRequested,
        and(
          eq(translationRequested.productId, products.id),
          eq(translationRequested.locale, locale.locale)
        )
      )
      .leftJoin(
        translationFallback,
        and(
          eq(translationFallback.productId, products.id),
          eq(translationFallback.locale, defaultLocale)
        )
      )
      .leftJoin(
        variantRequested,
        and(
          eq(variantRequested.variantId, productVariants.id),
          eq(variantRequested.locale, locale.locale)
        )
      )
      .leftJoin(
        variantFallback,
        and(
          eq(variantFallback.variantId, productVariants.id),
          eq(variantFallback.locale, defaultLocale)
        )
      )
      .leftJoin(
        productImages,
        and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true))
      )
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(eq(productVariants.id, variantId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const isPurchasable =
      row.productStatus === 'ACTIVE' &&
      row.productDeletedAt === null &&
      row.variantActive &&
      row.variantDeletedAt === null;

    return {
      variantId: row.variantId,
      productId: row.productId,
      productSlug: row.productSlug,
      storeId: row.storeId,
      vendorId: row.vendorId,
      categoryId: row.categoryId,
      productName: row.productName,
      variantLabel: row.variantLabel,
      unitLabel: row.unitLabel,
      imageKey: row.imageKey,
      pricePaise: row.pricePaise,
      mrpPaise: row.mrpPaise,
      isPurchasable,
      quantityAvailable: row.quantityAvailable,
      trackInventory: row.trackInventory ?? false,
      inStock: variantInStock(row.quantityAvailable, row.trackInventory),
      // A store that is closed or not accepting orders blocks the sale even when
      // the product itself is fine.
      storeAcceptingOrders: row.storeAcceptingOrders && row.storeStatus === 'OPEN',
      storeMinOrderPaise: row.storeMinOrderPaise,
    };
  }

  async listRelatedProducts(
    productId: string,
    locale: LocaleScope,
    limit = 8
  ): Promise<LocalisedProduct[]> {
    // The product's own category, read first so "related" cannot be spoofed by
    // passing a category id from the client.
    const owner = await this.ctx.db
      .select({ categoryId: products.categoryId })
      .from(products)
      .where(and(eq(products.id, productId), isNull(products.deletedAt)))
      .limit(1);

    const categoryId = owner[0]?.categoryId;
    if (!categoryId) return [];

    const requested = this.translationSubquery(locale.locale, 't_req');
    const fallback = this.translationSubquery(defaultLocale, 't_fb');
    const inv = this.inventorySummary();

    const rows = await this.ctx.db
      .with(requested, fallback, inv)
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
        sellableVariants: inv.sellableVariants,
      })
      .from(products)
      .leftJoin(requested, eq(requested.productId, products.id))
      .leftJoin(fallback, eq(fallback.productId, products.id))
      .leftJoin(
        productImages,
        and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true))
      )
      .leftJoin(inv, eq(inv.productId, products.id))
      .where(
        and(
          eq(products.categoryId, categoryId),
          ne(products.id, productId),
          eq(products.status, 'ACTIVE'),
          isNull(products.deletedAt)
        )
      )
      .orderBy(desc(products.soldCount), desc(products.id))
      .limit(resolveLimit(limit));

    return rows.map((row) => ({
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
      inStock: (row.sellableVariants ?? 0) > 0,
      usedFallbackLocale: row.usedFallbackLocale,
    }));
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

    const requested = this.translationSubquery(locale.locale, 't_req');
    const fallback = this.translationSubquery(defaultLocale, 't_fb');
    const inv = this.inventorySummary();
    const orderColumn = this.sortColumn(key);

    const [rows, totals] = await Promise.all([
      this.ctx.db
        .with(requested, fallback, inv)
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
          quantityAvailable: inv.quantityAvailable,
          quantityReserved: inv.quantityReserved,
          lowStockThreshold: inv.lowStockThreshold,
          trackInventory: inv.trackInventory,
          sellableVariants: inv.sellableVariants,
        })
        .from(products)
        .leftJoin(requested, eq(requested.productId, products.id))
        .leftJoin(fallback, eq(fallback.productId, products.id))
        .leftJoin(
          productImages,
          and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true))
        )
        .leftJoin(inv, eq(inv.productId, products.id))
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
      items: rows.map(({ sellableVariants, ...row }) => ({
        ...row,
        discountPercent: this.discountPercent(row.mrpPaise, row.pricePaise),
        inStock: (sellableVariants ?? 0) > 0,
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
    const requested = this.translationSubquery(locale.locale, 't_req');
    const fallback = this.translationSubquery(defaultLocale, 't_fb');
    const inv = this.inventorySummary();

    const rows = await this.ctx.db
      .with(requested, fallback, inv)
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
        quantityAvailable: inv.quantityAvailable,
        quantityReserved: inv.quantityReserved,
        lowStockThreshold: inv.lowStockThreshold,
        trackInventory: inv.trackInventory,
        sellableVariants: inv.sellableVariants,
      })
      .from(products)
      .leftJoin(requested, eq(requested.productId, products.id))
      .leftJoin(fallback, eq(fallback.productId, products.id))
      .leftJoin(
        productImages,
        and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true))
      )
      .leftJoin(inv, eq(inv.productId, products.id))
      .where(and(eq(products.id, productId), ...this.vendorPredicate(scope)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const { sellableVariants, ...rest } = row;

    return {
      ...rest,
      discountPercent: this.discountPercent(row.mrpPaise, row.pricePaise),
      inStock: (sellableVariants ?? 0) > 0,
    };
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
    // countDistinct, because a product with several low variants is still one
    // product to restock — the previous store-wide join counted it repeatedly.
    const rows = await this.ctx.db
      .select({ value: countDistinct(products.id) })
      .from(products)
      .innerJoin(
        productVariants,
        and(eq(productVariants.productId, products.id), isNull(productVariants.deletedAt))
      )
      .innerJoin(inventory, eq(inventory.variantId, productVariants.id))
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

    const requested = this.translationSubquery(locale.locale, 't_req');
    const fallback = this.translationSubquery(defaultLocale, 't_fb');
    const inv = this.inventorySummary();
    const orderColumn = this.sortColumn(key);

    const [rows, totals] = await Promise.all([
      this.ctx.db
        .with(requested, fallback, inv)
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
          quantityAvailable: inv.quantityAvailable,
          quantityReserved: inv.quantityReserved,
          lowStockThreshold: inv.lowStockThreshold,
          trackInventory: inv.trackInventory,
          sellableVariants: inv.sellableVariants,
        })
        .from(products)
        .leftJoin(requested, eq(requested.productId, products.id))
        .leftJoin(fallback, eq(fallback.productId, products.id))
        .leftJoin(
          productImages,
          and(eq(productImages.productId, products.id), eq(productImages.isPrimary, true))
        )
        .leftJoin(inv, eq(inv.productId, products.id))
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
      items: rows.map(({ sellableVariants, ...row }) => ({
        ...row,
        discountPercent: this.discountPercent(row.mrpPaise, row.pricePaise),
        inStock: (sellableVariants ?? 0) > 0,
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
            eq(productTranslations.locale, locale as Locale)
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
            eq(categoryTranslations.locale, locale as Locale)
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

  /**
   * One reusable translation CTE, so joins stay identical everywhere.
   *
   * ⚠️ THE ALIAS IS NAMED BY ROLE, NOT BY LOCALE. It used to be `t_${locale}`,
   * which collided whenever the requested locale WAS the fallback locale — i.e.
   * every English request, the default. Postgres rejected the statement with
   * `Alias "t_en" is already used in this query`, so every product listing, vendor
   * list and admin list was broken in English. It typechecked, and the in-memory
   * repository could not reproduce it; only executing the SQL surfaced it
   * (scripts/db-integration-check.sh).
   */
  private translationSubquery(locale: Locale, alias: 't_req' | 't_fb') {
    return this.ctx.db.$with(alias).as(
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

  /** Localised category rows for an arbitrary predicate, consistently ordered. */
  private async selectCategories(locale: Locale, conditions: SQL[]): Promise<LocalisedCategory[]> {
    const translationRequested = alias(categoryTranslations, 'ct_req');
    const translationFallback = alias(categoryTranslations, 'ct_fb');

    return this.ctx.db
      .select({
        id: categories.id,
        slug: categories.slug,
        parentId: categories.parentId,
        iconKey: categories.iconKey,
        imageKey: categories.imageKey,
        displayOrder: categories.displayOrder,
        isFeatured: categories.isFeatured,
        name: sql<string>`coalesce(${translationRequested.name}, ${translationFallback.name})`,
        description: sql<
          string | null
        >`coalesce(${translationRequested.description}, ${translationFallback.description})`,
        usedFallbackLocale: sql<boolean>`${translationRequested.name} is null`,
      })
      .from(categories)
      .leftJoin(
        translationRequested,
        and(
          eq(translationRequested.categoryId, categories.id),
          eq(translationRequested.locale, locale)
        )
      )
      .leftJoin(
        translationFallback,
        and(
          eq(translationFallback.categoryId, categories.id),
          eq(translationFallback.locale, defaultLocale)
        )
      )
      .where(and(...conditions))
      .orderBy(asc(categories.displayOrder), asc(categories.slug));
  }

  private async listProductImages(productId: string): Promise<ProductImageRecord[]> {
    return this.ctx.db
      .select({
        storageKey: productImages.storageKey,
        altText: productImages.altText,
        displayOrder: productImages.displayOrder,
        isPrimary: productImages.isPrimary,
        width: productImages.width,
        height: productImages.height,
        variantId: productImages.variantId,
      })
      .from(productImages)
      .where(eq(productImages.productId, productId))
      .orderBy(desc(productImages.isPrimary), asc(productImages.displayOrder));
  }

  private async listProductVariants(
    productId: string,
    locale: Locale
  ): Promise<LocalisedVariant[]> {
    const translationRequested = alias(productVariantTranslations, 'vt_req');
    const translationFallback = alias(productVariantTranslations, 'vt_fb');

    const rows = await this.ctx.db
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        mrpPaise: productVariants.mrpPaise,
        pricePaise: productVariants.pricePaise,
        unitLabel: productVariants.unitLabel,
        isDefault: productVariants.isDefault,
        displayOrder: productVariants.displayOrder,
        name: sql<
          string | null
        >`coalesce(${translationRequested.name}, ${translationFallback.name})`,
        variantLabel: sql<
          string | null
        >`coalesce(${translationRequested.variantLabel}, ${translationFallback.variantLabel})`,
        quantityAvailable: inventory.quantityAvailable,
        trackInventory: inventory.trackInventory,
      })
      .from(productVariants)
      .leftJoin(
        translationRequested,
        and(
          eq(translationRequested.variantId, productVariants.id),
          eq(translationRequested.locale, locale)
        )
      )
      .leftJoin(
        translationFallback,
        and(
          eq(translationFallback.variantId, productVariants.id),
          eq(translationFallback.locale, defaultLocale)
        )
      )
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(
        and(
          eq(productVariants.productId, productId),
          eq(productVariants.isActive, true),
          isNull(productVariants.deletedAt)
        )
      )
      .orderBy(desc(productVariants.isDefault), asc(productVariants.displayOrder));

    return rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      variantLabel: row.variantLabel,
      unitLabel: row.unitLabel,
      mrpPaise: row.mrpPaise,
      pricePaise: row.pricePaise,
      discountPercent: this.discountPercent(row.mrpPaise, row.pricePaise),
      isDefault: row.isDefault,
      displayOrder: row.displayOrder,
      quantityAvailable: row.quantityAvailable,
      trackInventory: row.trackInventory ?? false,
      inStock: variantInStock(row.quantityAvailable, row.trackInventory),
    }));
  }

  /**
   * The expression rows are ordered by.
   *
   * `rating_avg` is COALESCEd to 0 rather than used raw: it is nullable, and a
   * NULL inside a row-comparison keyset predicate makes the whole comparison NULL,
   * which silently drops every unrated product from paginated results.
   */
  private sortColumn(key: ProductSortKey): SQL {
    switch (key) {
      case 'pricePaise':
        return sql`${products.pricePaise}`;
      case 'ratingAvg':
        return sql`coalesce(${products.ratingAvg}, 0)`;
      case 'soldCount':
        return sql`${products.soldCount}`;
      case 'createdAt':
      default:
        return sql`${products.createdAt}`;
    }
  }

  /** Stringifies the sort value of a row for embedding in a cursor. */
  private cursorValue(
    key: ProductSortKey,
    row: { createdAt: Date; pricePaise: number; ratingAvg: string | null; soldCount?: number }
  ): string {
    switch (key) {
      case 'pricePaise':
        return String(row.pricePaise);
      case 'ratingAvg':
        return row.ratingAvg ?? '0';
      case 'soldCount':
        return String(row.soldCount ?? 0);
      case 'createdAt':
      default:
        return row.createdAt.toISOString();
    }
  }

  /**
   * Keyset predicate for the requested sort.
   *
   * The cursor value arrives as text, so it is cast to the column's type
   * explicitly — comparing `(bigint, uuid)` against `(text, text)` is an error in
   * Postgres, not an implicit coercion.
   */
  private cursorPredicate(
    key: ProductSortKey,
    direction: 'asc' | 'desc',
    value: string,
    id: string
  ): SQL {
    const column = this.sortColumn(key);

    const typedValue =
      key === 'createdAt'
        ? sql`${value}::timestamptz`
        : key === 'ratingAvg'
          ? sql`${value}::numeric`
          : sql`${value}::bigint`;

    return direction === 'desc'
      ? sql`(${column}, ${products.id}) < (${typedValue}, ${id}::uuid)`
      : sql`(${column}, ${products.id}) > (${typedValue}, ${id}::uuid)`;
  }

  /** Filters are built from named parameters only — never raw client SQL. */
  private buildFilterConditions(filters: ProductListFilters): SQL[] {
    const conditions: SQL[] = [];

    if (filters.categoryId) conditions.push(eq(products.categoryId, filters.categoryId));
    if (filters.categoryIds && filters.categoryIds.length > 0) {
      conditions.push(inArray(products.categoryId, [...filters.categoryIds]));
    }
    if (filters.productIds) {
      // An empty list must match nothing rather than being ignored: silently
      // dropping the filter would turn "no search results" into "the whole
      // catalogue".
      conditions.push(
        filters.productIds.length > 0 ? inArray(products.id, [...filters.productIds]) : sql`false`
      );
    }
    if (filters.brandId) conditions.push(eq(products.brandId, filters.brandId));

    // Previously declared but never applied — an admin filtering by status silently
    // got every status back.
    if (filters.status) {
      conditions.push(eq(products.status, filters.status as 'ACTIVE'));
    }

    if (filters.minPricePaise !== undefined) {
      conditions.push(gte(products.pricePaise, filters.minPricePaise));
    }
    if (filters.maxPricePaise !== undefined) {
      conditions.push(lte(products.pricePaise, filters.maxPricePaise));
    }

    // Also previously unapplied. EXISTS rather than a join, so a product with
    // several sellable variants is not returned several times.
    if (filters.inStockOnly) {
      conditions.push(
        sql`exists (
          select 1
          from ${productVariants}
          join ${inventory} on ${inventory.variantId} = ${productVariants.id}
          where ${productVariants.productId} = ${products.id}
            and ${productVariants.deletedAt} is null
            and ${productVariants.isActive} = true
            and (${inventory.trackInventory} = false or ${inventory.quantityAvailable} > 0)
        )`
      );
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

/** Factory used by the service layer, which never constructs the class directly. */
export function createCatalogRepository(ctx: RepositoryContext): CatalogRepository {
  return new DrizzleCatalogRepository(ctx);
}
