import { CATEGORIES } from '@/db/seed/reference-data';
import { DEV_PRODUCTS, DEV_STORE, DEV_VENDOR } from '@/db/seed/dev-data';
import { defaultLocale, type Locale } from '@/i18n/routing';
import { decodeCursor, encodeCursor } from '@/lib/db/cursor';
import { fixtureId } from '@/lib/db/fixture-id';
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
  type VendorScope,
} from '@/lib/db/repository';
import {
  PRODUCT_SORT_KEYS,
  SITEMAP_MAX_ENTRIES,
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
  type SitemapEntries,
  type TranslationCompleteness,
  type VendorProduct,
} from './catalog.repository.types';

/**
 * In-memory catalog repository.
 *
 * WHY THIS EXISTS: the application must run and pass its full test suite with no
 * external dependencies (.kiro/steering/provider-credentials.md). A managed
 * Postgres provider is still unchosen (D-01a) and no migrations have been
 * generated, so without this the catalogue could not be exercised at all and the
 * public preview would show nothing but empty states.
 *
 * SINGLE SOURCE OF TRUTH: the data is `CATEGORIES` from the seed reference data
 * and `DEV_PRODUCTS`/`DEV_STORE`/`DEV_VENDOR` from the dev fixtures — the exact
 * rows `pnpm seed` writes. Hand-written fixtures here would let the fake and the
 * real database drift, which is the classic failure of this pattern.
 *
 * It replaces the I/O, NOT the rules. Locale fallback, visibility filtering,
 * sorting, keyset pagination and stock derivation all mirror the SQL, because a
 * fake with different semantics turns green tests into false confidence.
 *
 * Refused in production by `modules/catalog/index.ts`.
 */

// ---------------------------------------------------------------------------
// Fixture shapes
// ---------------------------------------------------------------------------

type TranslationMap<T> = Partial<Record<Locale, T>>;

interface MemoryCategory {
  id: string;
  slug: string;
  parentId: string | null;
  iconKey: string | null;
  imageKey: string | null;
  displayOrder: number;
  isActive: boolean;
  isFeatured: boolean;
  translations: TranslationMap<{ name: string; description?: string | undefined }>;
}

interface MemoryVariant {
  id: string;
  sku: string | null;
  mrpPaise: number;
  pricePaise: number;
  unitLabel: string | null;
  isDefault: boolean;
  displayOrder: number;
  isActive: boolean;
  quantityAvailable: number;
  quantityReserved: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  translations: TranslationMap<{ name: string; variantLabel?: string | undefined }>;
}

interface MemoryProduct {
  id: string;
  slug: string;
  vendorId: string;
  storeId: string;
  categoryId: string;
  categorySlug: string;
  status: string;
  isFeatured: boolean;
  isPopular: boolean;
  unitLabel: string | null;
  mrpPaise: number;
  pricePaise: number;
  costPaise: number | null;
  ratingAvg: string | null;
  ratingCount: number;
  soldCount: number;
  version: number;
  publishedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  translations: TranslationMap<{
    name: string;
    shortDescription: string;
    description?: string | undefined;
  }>;
  images: ProductImageRecord[];
  variants: MemoryVariant[];
}

/**
 * Fixed base timestamp.
 *
 * Deterministic `createdAt` values matter: sorting and keyset pagination are
 * ordered by them, so wall-clock values would make tests non-reproducible.
 */
const FIXTURE_EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0);

/**
 * Last-modified stamp for fixture categories.
 *
 * Fixed rather than `new Date()`: a sitemap whose `lastmod` changed on every request
 * tells crawlers everything changed constantly, which is both untrue and a good way
 * to waste crawl budget.
 */
const FIXTURE_UPDATED_AT = new Date(FIXTURE_EPOCH);

const STORE_ID = fixtureId('store', DEV_STORE.slug);
const VENDOR_ID = fixtureId('vendor', DEV_VENDOR.slug);

function buildCategories(): MemoryCategory[] {
  const rows: MemoryCategory[] = [];

  for (const category of CATEGORIES) {
    const id = fixtureId('category', category.slug);

    rows.push({
      id,
      slug: category.slug,
      parentId: null,
      // The seed does not author icons or images, so neither does this.
      iconKey: null,
      imageKey: null,
      displayOrder: category.displayOrder,
      isActive: true,
      isFeatured: category.isFeatured,
      translations: category.translations,
    });

    for (const child of category.children ?? []) {
      rows.push({
        id: fixtureId('category', child.slug),
        slug: child.slug,
        parentId: id,
        iconKey: null,
        imageKey: null,
        displayOrder: child.displayOrder,
        isActive: true,
        isFeatured: false,
        translations: child.translations,
      });
    }
  }

  return rows;
}

function buildProducts(categories: MemoryCategory[]): MemoryProduct[] {
  return DEV_PRODUCTS.map((product, index) => {
    const category = categories.find((candidate) => candidate.slug === product.categorySlug);
    if (!category) {
      throw new Error(
        `Dev fixture product "${product.slug}" references unknown category "${product.categorySlug}".`
      );
    }

    const createdAt = new Date(FIXTURE_EPOCH + index * 60_000);

    // Every product has exactly one default variant. The schema requires at least
    // one (`product_variants_default_key`), and the flat `stock` in the fixture is
    // that variant's inventory.
    const variant: MemoryVariant = {
      id: fixtureId('variant', product.slug),
      sku: null,
      mrpPaise: product.mrpPaise,
      pricePaise: product.pricePaise,
      unitLabel: product.unitLabel,
      isDefault: true,
      displayOrder: 0,
      isActive: true,
      quantityAvailable: product.stock,
      quantityReserved: 0,
      lowStockThreshold: 0,
      trackInventory: true,
      translations: {},
    };

    return {
      id: fixtureId('product', product.slug),
      slug: product.slug,
      vendorId: VENDOR_ID,
      storeId: STORE_ID,
      categoryId: category.id,
      categorySlug: category.slug,
      status: 'ACTIVE',
      isFeatured: index < 3,
      isPopular: index < 4,
      unitLabel: product.unitLabel,
      mrpPaise: product.mrpPaise,
      pricePaise: product.pricePaise,
      // Vendor-private and not part of the fixture; left null rather than invented.
      costPaise: null,
      ratingAvg: null,
      ratingCount: 0,
      soldCount: 0,
      version: 1,
      publishedAt: createdAt,
      createdAt,
      deletedAt: null,
      translations: product.translations,
      // No image fixtures exist and the loader is still decision D-07a, so the UI
      // renders its placeholder rather than a fabricated URL.
      images: [],
      variants: [variant],
    };
  });
}

// ---------------------------------------------------------------------------
// Localisation, mirroring the SQL COALESCE
// ---------------------------------------------------------------------------

function resolveTranslation<T>(
  translations: TranslationMap<T>,
  locale: Locale
): { value: T | undefined; usedFallbackLocale: boolean } {
  const requested = translations[locale];
  if (requested) return { value: requested, usedFallbackLocale: false };

  // Matches `usedFallbackLocale: requested.name is null` in SQL: true whenever the
  // requested locale had no row, even if the fallback has none either.
  return { value: translations[defaultLocale], usedFallbackLocale: true };
}

function discountPercent(mrpPaise: number, pricePaise: number): number | null {
  if (mrpPaise <= 0 || pricePaise >= mrpPaise) return null;
  return Math.round(((mrpPaise - pricePaise) / mrpPaise) * 100);
}

function variantInStock(variant: MemoryVariant): boolean {
  if (!variant.trackInventory) return true;
  return variant.quantityAvailable > 0;
}

function sellableVariants(product: MemoryProduct): number {
  return product.variants.filter((variant) => variant.isActive && variantInStock(variant)).length;
}

export class InMemoryCatalogRepository implements CatalogRepository {
  private readonly categories: MemoryCategory[];
  private readonly products: MemoryProduct[];

  constructor(categories: MemoryCategory[] = buildCategories(), products?: MemoryProduct[]) {
    this.categories = categories;
    this.products = products ?? buildProducts(categories);
  }

  // -------------------------------------------------------------------------
  // Public reads
  // -------------------------------------------------------------------------

  private toLocalisedProduct(product: MemoryProduct, locale: Locale): LocalisedProduct {
    const { value, usedFallbackLocale } = resolveTranslation(product.translations, locale);
    const primary = product.images.find((image) => image.isPrimary) ?? product.images[0];

    return {
      id: product.id,
      slug: product.slug,
      // The English row is mandatory in the real schema, so a missing name here
      // would be a fixture bug rather than a runtime condition.
      name: value?.name ?? product.slug,
      shortDescription: value?.shortDescription ?? null,
      unitLabel: product.unitLabel,
      status: product.status,
      mrpPaise: product.mrpPaise,
      pricePaise: product.pricePaise,
      discountPercent: discountPercent(product.mrpPaise, product.pricePaise),
      ratingAvg: product.ratingAvg,
      ratingCount: product.ratingCount,
      primaryImageKey: primary?.storageKey ?? null,
      primaryImageAlt: primary?.altText ?? null,
      categoryId: product.categoryId,
      storeId: product.storeId,
      inStock: sellableVariants(product) > 0,
      usedFallbackLocale,
    };
  }

  private toLocalisedCategory(category: MemoryCategory, locale: Locale): LocalisedCategory {
    const { value, usedFallbackLocale } = resolveTranslation(category.translations, locale);

    return {
      id: category.id,
      slug: category.slug,
      name: value?.name ?? category.slug,
      description: value?.description ?? null,
      iconKey: category.iconKey,
      imageKey: category.imageKey,
      parentId: category.parentId,
      displayOrder: category.displayOrder,
      isFeatured: category.isFeatured,
      usedFallbackLocale,
    };
  }

  /** Public visibility, matching `status = 'ACTIVE' and deleted_at is null`. */
  private isPubliclyVisible(product: MemoryProduct): boolean {
    return product.status === 'ACTIVE' && product.deletedAt === null;
  }

  async findProductBySlug(slug: string, locale: LocaleScope): Promise<LocalisedProduct | null> {
    const product = this.products.find(
      (candidate) => candidate.slug === slug && this.isPubliclyVisible(candidate)
    );

    return product ? this.toLocalisedProduct(product, locale.locale) : null;
  }

  async listProducts(
    filters: ProductListFilters,
    locale: LocaleScope,
    page: CursorPage,
    sort?: string
  ): Promise<CursorResult<LocalisedProduct>> {
    const limit = resolveLimit(page.limit);
    const { key, direction } = resolveSort<ProductSortKey>(sort, PRODUCT_SORT_KEYS, 'createdAt');

    const matched = this.products
      .filter((product) => this.isPubliclyVisible(product))
      .filter((product) => this.matchesFilters(product, filters, locale.locale));

    const sorted = this.sortProducts(matched, key, direction);

    // Keyset pagination, mirroring the SQL row-comparison: keep rows strictly
    // after the cursor position in the current ordering.
    let windowed = sorted;
    if (page.cursor) {
      const decoded = decodeCursor(page.cursor, key);
      if (decoded) {
        const index = sorted.findIndex(
          (product) => this.sortValue(product, key) === decoded.value && product.id === decoded.id
        );
        if (index >= 0) windowed = sorted.slice(index + 1);
      }
    }

    const hasMore = windowed.length > limit;
    const pageRows = windowed.slice(0, limit);
    const last = hasMore ? pageRows[pageRows.length - 1] : undefined;

    return {
      items: pageRows.map((product) => this.toLocalisedProduct(product, locale.locale)),
      nextCursor: last ? encodeCursor(key, this.sortValue(last, key), last.id) : null,
      hasMore,
    };
  }

  async listCategoryTree(locale: LocaleScope): Promise<CategoryTreeNode[]> {
    const active = this.categories.filter((category) => category.isActive);

    const roots = active
      .filter((category) => category.parentId === null)
      .sort(compareCategories)
      .map((category) => this.toLocalisedCategory(category, locale.locale));

    return roots.map((root) => ({
      ...root,
      children: active
        .filter((category) => category.parentId === root.id)
        .sort(compareCategories)
        .map((category) => this.toLocalisedCategory(category, locale.locale)),
    }));
  }

  async findCategoryBySlug(slug: string, locale: LocaleScope): Promise<CategoryDetail | null> {
    const category = this.categories.find(
      (candidate) => candidate.slug === slug && candidate.isActive
    );
    if (!category) return null;

    const localised = this.toLocalisedCategory(category, locale.locale);

    const children = this.categories
      .filter((candidate) => candidate.parentId === category.id && candidate.isActive)
      .sort(compareCategories)
      .map((candidate) => this.toLocalisedCategory(candidate, locale.locale));

    const parent = category.parentId
      ? this.categories.find((candidate) => candidate.id === category.parentId)
      : undefined;

    return {
      ...localised,
      children,
      ancestors: parent
        ? [
            {
              id: parent.id,
              slug: parent.slug,
              name: this.toLocalisedCategory(parent, locale.locale).name,
            },
          ]
        : [],
      // No `seo_meta` rows are seeded; the service falls back to name/description.
      metaTitle: null,
      metaDescription: null,
    };
  }

  async findProductDetailBySlug(
    slug: string,
    locale: LocaleScope
  ): Promise<LocalisedProductDetail | null> {
    const product = this.products.find(
      (candidate) => candidate.slug === slug && this.isPubliclyVisible(candidate)
    );
    if (!product) return null;

    const base = this.toLocalisedProduct(product, locale.locale);
    const { value } = resolveTranslation(product.translations, locale.locale);

    const category = this.categories.find((candidate) => candidate.id === product.categoryId);
    const categoryName = category
      ? this.toLocalisedCategory(category, locale.locale).name
      : product.categorySlug;

    return {
      ...base,
      description: value?.description ?? null,
      specifications: null,
      images: product.images,
      variants: product.variants
        .filter((variant) => variant.isActive)
        .sort(compareVariants)
        .map((variant) => this.toLocalisedVariant(variant, locale.locale)),
      store: {
        id: product.storeId,
        slug: DEV_STORE.slug,
        name: DEV_STORE.name,
        city: DEV_STORE.city,
        pincode: DEV_STORE.pincode,
        codEnabled: DEV_STORE.codEnabled,
        avgPrepTimeMinutes: DEV_STORE.avgPrepTimeMinutes,
        status: DEV_STORE.status,
      },
      categorySlug: product.categorySlug,
      categoryName,
      brandName: null,
      metaTitle: null,
      metaDescription: null,
    };
  }

  private toLocalisedVariant(variant: MemoryVariant, locale: Locale): LocalisedVariant {
    const { value } = resolveTranslation(variant.translations, locale);

    return {
      id: variant.id,
      sku: variant.sku,
      name: value?.name ?? null,
      variantLabel: value?.variantLabel ?? null,
      unitLabel: variant.unitLabel,
      mrpPaise: variant.mrpPaise,
      pricePaise: variant.pricePaise,
      discountPercent: discountPercent(variant.mrpPaise, variant.pricePaise),
      isDefault: variant.isDefault,
      displayOrder: variant.displayOrder,
      quantityAvailable: variant.quantityAvailable,
      trackInventory: variant.trackInventory,
      inStock: variantInStock(variant),
    };
  }

  async getProductAvailability(productId: string): Promise<ProductAvailability | null> {
    const product = this.products.find((candidate) => candidate.id === productId);
    if (!product) return null;

    const active = product.variants.filter((variant) => variant.isActive).sort(compareVariants);
    if (active.length === 0) return null;

    const isPublished = this.isPubliclyVisible(product);

    const variants = active.map((variant) => ({
      variantId: variant.id,
      isDefault: variant.isDefault,
      pricePaise: variant.pricePaise,
      mrpPaise: variant.mrpPaise,
      quantityAvailable: variant.quantityAvailable,
      trackInventory: variant.trackInventory,
      inStock: variantInStock(variant),
    }));

    return {
      productId,
      isPublished,
      inStock: isPublished && variants.some((variant) => variant.inStock),
      variants,
    };
  }

  async findPurchasableVariant(
    variantId: string,
    locale: LocaleScope
  ): Promise<PurchasableVariant | null> {
    const product = this.products.find((candidate) =>
      candidate.variants.some((variant) => variant.id === variantId)
    );
    if (!product) return null;

    const variant = product.variants.find((candidate) => candidate.id === variantId);
    if (!variant) return null;

    const localised = this.toLocalisedProduct(product, locale.locale);
    const variantTranslation = resolveTranslation(variant.translations, locale.locale).value;

    return {
      variantId: variant.id,
      productId: product.id,
      productSlug: product.slug,
      storeId: product.storeId,
      vendorId: product.vendorId,
      categoryId: product.categoryId,
      productName: localised.name,
      variantLabel: variantTranslation?.variantLabel ?? null,
      unitLabel: variant.unitLabel ?? product.unitLabel,
      imageKey: localised.primaryImageKey,
      pricePaise: variant.pricePaise,
      mrpPaise: variant.mrpPaise,
      isPurchasable: this.isPubliclyVisible(product) && variant.isActive,
      quantityAvailable: variant.quantityAvailable,
      trackInventory: variant.trackInventory,
      inStock: variantInStock(variant),
      // DEV_STORE is seeded OPEN and accepting orders.
      storeAcceptingOrders: DEV_STORE.status === 'OPEN',
      storeMinOrderPaise: DEV_STORE.minOrderPaise,
    };
  }

  async listRelatedProducts(
    productId: string,
    locale: LocaleScope,
    limit = 8
  ): Promise<LocalisedProduct[]> {
    const product = this.products.find((candidate) => candidate.id === productId);
    if (!product) return [];

    return this.products
      .filter(
        (candidate) =>
          candidate.categoryId === product.categoryId &&
          candidate.id !== productId &&
          this.isPubliclyVisible(candidate)
      )
      .sort((a, b) => b.soldCount - a.soldCount || (a.id < b.id ? 1 : -1))
      .slice(0, resolveLimit(limit))
      .map((candidate) => this.toLocalisedProduct(candidate, locale.locale));
  }

  listSitemapEntries(limit = SITEMAP_MAX_ENTRIES): Promise<SitemapEntries> {
    const cap = Math.max(1, limit);

    const categoryEntries = this.categories
      .filter((category) => category.isActive)
      .map((category) => ({ slug: category.slug, updatedAt: FIXTURE_UPDATED_AT }))
      // Same ordering as the SQL, so the two cannot produce different sitemaps.
      .sort((a, b) => a.slug.localeCompare(b.slug));

    const productEntries = this.products
      .filter((product) => this.isPubliclyVisible(product))
      .map((product) => ({ slug: product.slug, updatedAt: product.createdAt }))
      .sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.slug.localeCompare(b.slug)
      );

    return Promise.resolve({
      categories: categoryEntries.slice(0, cap),
      products: productEntries.slice(0, cap),
      isTruncated: categoryEntries.length > cap || productEntries.length > cap,
    });
  }

  // -------------------------------------------------------------------------
  // Vendor reads — same tenant isolation as the SQL
  // -------------------------------------------------------------------------

  private toVendorProduct(product: MemoryProduct, locale: Locale): VendorProduct {
    const tracked = product.variants.filter((variant) => variant.isActive);

    return {
      ...this.toLocalisedProduct(product, locale),
      costPaise: product.costPaise,
      version: product.version,
      publishedAt: product.publishedAt,
      quantityAvailable: tracked.reduce((total, variant) => total + variant.quantityAvailable, 0),
      quantityReserved: tracked.reduce((total, variant) => total + variant.quantityReserved, 0),
      lowStockThreshold: tracked.reduce(
        (lowest, variant) => Math.min(lowest, variant.lowStockThreshold),
        tracked[0]?.lowStockThreshold ?? 0
      ),
      trackInventory: tracked.some((variant) => variant.trackInventory),
    };
  }

  private matchesVendorScope(product: MemoryProduct, scope: VendorScope): boolean {
    if (product.deletedAt !== null) return false;
    if (product.vendorId !== scope.vendorId) return false;
    if (scope.storeId && product.storeId !== scope.storeId) return false;
    return true;
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

    const matched = this.products
      .filter((product) => this.matchesVendorScope(product, scope))
      .filter((product) => this.matchesFilters(product, filters, locale.locale));

    const sorted = this.sortProducts(matched, key, direction);
    const rows = sorted.slice(offset, offset + limit);

    return {
      items: rows.map((product) => this.toVendorProduct(product, locale.locale)),
      page: currentPage,
      pageSize: limit,
      total: sorted.length,
      hasMore: offset + rows.length < sorted.length,
    };
  }

  async findVendorProductById(
    scope: VendorScope,
    productId: string,
    locale: LocaleScope
  ): Promise<VendorProduct | null> {
    const product = this.products.find(
      (candidate) => candidate.id === productId && this.matchesVendorScope(candidate, scope)
    );

    return product ? this.toVendorProduct(product, locale.locale) : null;
  }

  async isProductOwnedByVendor(scope: VendorScope, productId: string): Promise<boolean> {
    return this.products.some(
      (candidate) => candidate.id === productId && this.matchesVendorScope(candidate, scope)
    );
  }

  async countLowStockProducts(scope: VendorScope): Promise<number> {
    return this.products.filter(
      (product) =>
        this.matchesVendorScope(product, scope) &&
        product.variants.some(
          (variant) =>
            variant.isActive &&
            variant.trackInventory &&
            variant.quantityAvailable <= variant.lowStockThreshold
        )
    ).length;
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

    const matched = this.products
      .filter((product) => product.deletedAt === null)
      .filter((product) => this.matchesFilters(product, filters, locale.locale));

    const sorted = this.sortProducts(matched, key, direction);
    const rows = sorted.slice(offset, offset + limit);

    return {
      items: rows.map((product) => this.toVendorProduct(product, locale.locale)),
      page: currentPage,
      pageSize: limit,
      total: sorted.length,
      hasMore: offset + rows.length < sorted.length,
    };
  }

  async getTranslationCompleteness(
    scope: AdminScope,
    locale: string
  ): Promise<TranslationCompleteness[]> {
    void scope;
    const target = locale as Locale;

    const countFor = <T>(rows: Array<{ translations: TranslationMap<T> }>) => {
      const total = rows.length;
      const translated = rows.filter((row) => row.translations[target] !== undefined).length;
      return { total, translated, missing: Math.max(0, total - translated) };
    };

    const productStats = countFor(this.products.filter((product) => product.deletedAt === null));
    const categoryStats = countFor(this.categories);

    return [
      { entity: 'products', locale, ...productStats },
      { entity: 'categories', locale, ...categoryStats },
    ];
  }

  // -------------------------------------------------------------------------
  // Filtering and sorting, mirroring buildFilterConditions / sortColumn
  // -------------------------------------------------------------------------

  private matchesFilters(
    product: MemoryProduct,
    filters: ProductListFilters,
    locale: Locale
  ): boolean {
    if (filters.categoryId && product.categoryId !== filters.categoryId) return false;
    if (filters.categoryIds && filters.categoryIds.length > 0) {
      if (!filters.categoryIds.includes(product.categoryId)) return false;
    }
    // An empty list matches nothing, mirroring the SQL.
    if (filters.productIds && !filters.productIds.includes(product.id)) return false;
    if (filters.brandId) return false;
    if (filters.status && product.status !== filters.status) return false;
    if (filters.minPricePaise !== undefined && product.pricePaise < filters.minPricePaise) {
      return false;
    }
    if (filters.maxPricePaise !== undefined && product.pricePaise > filters.maxPricePaise) {
      return false;
    }
    if (filters.inStockOnly && sellableVariants(product) === 0) return false;

    if (filters.search) {
      // Matches the SQL EXISTS: any locale's name or short description, case
      // insensitively, so a Hindi query still finds a product on an English page.
      const term = filters.search.toLowerCase();
      const haystacks = Object.values(product.translations).flatMap((translation) =>
        translation ? [translation.name, translation.shortDescription] : []
      );
      void locale;
      if (!haystacks.some((text) => text?.toLowerCase().includes(term))) return false;
    }

    return true;
  }

  /** Stringified sort value, matching the cursor payload the SQL repository writes. */
  private sortValue(product: MemoryProduct, key: ProductSortKey): string {
    switch (key) {
      case 'pricePaise':
        return String(product.pricePaise);
      case 'ratingAvg':
        return product.ratingAvg ?? '0';
      case 'soldCount':
        return String(product.soldCount);
      case 'createdAt':
      default:
        return product.createdAt.toISOString();
    }
  }

  private sortProducts(
    rows: MemoryProduct[],
    key: ProductSortKey,
    direction: 'asc' | 'desc'
  ): MemoryProduct[] {
    const factor = direction === 'desc' ? -1 : 1;

    const compare = (a: MemoryProduct, b: MemoryProduct): number => {
      let primary = 0;

      switch (key) {
        case 'pricePaise':
          primary = a.pricePaise - b.pricePaise;
          break;
        case 'ratingAvg':
          primary = Number(a.ratingAvg ?? 0) - Number(b.ratingAvg ?? 0);
          break;
        case 'soldCount':
          primary = a.soldCount - b.soldCount;
          break;
        case 'createdAt':
        default:
          primary = a.createdAt.getTime() - b.createdAt.getTime();
          break;
      }

      // Always tie-break on id, in the same direction, so pages neither repeat
      // nor skip rows when the sort value is shared.
      if (primary !== 0) return primary * factor;
      return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * factor;
    };

    return [...rows].sort(compare);
  }
}

function compareCategories(a: MemoryCategory, b: MemoryCategory): number {
  return a.displayOrder - b.displayOrder || a.slug.localeCompare(b.slug);
}

function compareVariants(a: MemoryVariant, b: MemoryVariant): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  return a.displayOrder - b.displayOrder;
}

/** Slugs the in-memory catalogue can serve. Used by development diagnostics. */
export function inMemoryCatalogSummary(): {
  categorySlugs: string[];
  productSlugs: string[];
} {
  return {
    categorySlugs: buildCategories().map((category) => category.slug),
    productSlugs: DEV_PRODUCTS.map((product) => product.slug),
  };
}
