import type {
  AdminScope,
  CursorPage,
  CursorResult,
  LocaleScope,
  OffsetPage,
  OffsetResult,
  VendorScope,
} from '@/lib/db/repository';

/**
 * Catalog repository contract.
 *
 * Interfaces live separately from the implementation so services depend on the
 * contract, not on Drizzle types. That is what keeps the module extractable into
 * a separate API service later (docs/ARCHITECTURE.md §5.1).
 */

/** A product as the customer-facing surface needs it, already localised. */
export interface LocalisedProduct {
  id: string;
  slug: string;
  /** Resolved for the requested locale, falling back to English. */
  name: string;
  shortDescription: string | null;
  unitLabel: string | null;
  status: string;
  mrpPaise: number;
  pricePaise: number;
  /** Present only when a real discount exists, so the UI cannot show "0% off". */
  discountPercent: number | null;
  ratingAvg: string | null;
  ratingCount: number;
  primaryImageKey: string | null;
  primaryImageAlt: string | null;
  categoryId: string;
  storeId: string;
  /**
   * Whether any variant can currently be sold.
   *
   * Derived from inventory in the same query, because a listing that shows an
   * "Add" button on a sold-out product is worse than not showing the product.
   */
  inStock: boolean;
  /**
   * True when the requested locale had no translation row and English was used.
   * Surfaced so the admin translation-completeness view can report gaps.
   */
  usedFallbackLocale: boolean;
}

/** A product as the OWNING vendor sees it. Includes vendor-private fields. */
export interface VendorProduct extends LocalisedProduct {
  /** Vendor-private: never exposed on a customer surface. */
  costPaise: number | null;
  version: number;
  publishedAt: Date | null;
  quantityAvailable: number | null;
  quantityReserved: number | null;
  lowStockThreshold: number | null;
  trackInventory: boolean | null;
}

/**
 * A category, already localised.
 *
 * `name`/`description` come from `category_translations` (D-33); the slug is
 * canonical and NOT translated in V1, so one URL serves both locales.
 */
export interface LocalisedCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconKey: string | null;
  imageKey: string | null;
  parentId: string | null;
  displayOrder: number;
  isFeatured: boolean;
  usedFallbackLocale: boolean;
}

/** A root category with its immediate children. The tree is 2 deep by rule. */
export interface CategoryTreeNode extends LocalisedCategory {
  children: LocalisedCategory[];
}

/** Category detail for `/category/[slug]`, including SEO copy when authored. */
export interface CategoryDetail extends LocalisedCategory {
  children: LocalisedCategory[];
  /** Ancestor chain, nearest-last, for breadcrumbs. Empty for a root category. */
  ancestors: Array<{ id: string; slug: string; name: string }>;
  metaTitle: string | null;
  metaDescription: string | null;
}

/** A purchasable variant, already localised. */
export interface LocalisedVariant {
  id: string;
  sku: string | null;
  /** Variant-specific name, when authored. Falls back to the product name. */
  name: string | null;
  variantLabel: string | null;
  unitLabel: string | null;
  mrpPaise: number;
  pricePaise: number;
  discountPercent: number | null;
  isDefault: boolean;
  displayOrder: number;
  /** Null when the variant has no inventory row at all. */
  quantityAvailable: number | null;
  trackInventory: boolean;
  inStock: boolean;
}

export interface ProductImageRecord {
  storageKey: string;
  altText: string;
  displayOrder: number;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
  variantId: string | null;
}

/** The store a product is sold by. Needed for ETA and COD eligibility display. */
export interface ProductStoreSummary {
  id: string;
  slug: string;
  name: string;
  /** Nullable in the schema; a store may be registered before its address is. */
  city: string | null;
  pincode: string | null;
  codEnabled: boolean;
  avgPrepTimeMinutes: number | null;
  status: string;
}

/** Everything `/products/[slug]` renders, in one read. */
export interface LocalisedProductDetail extends LocalisedProduct {
  description: string | null;
  /** Free-form `jsonb` authored per locale. Shape is not enforced by the schema. */
  specifications: unknown;
  images: ProductImageRecord[];
  variants: LocalisedVariant[];
  store: ProductStoreSummary;
  categorySlug: string;
  categoryName: string;
  brandName: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

/**
 * Live price and stock for one variant.
 *
 * This is what `/products/[slug]` trusts at request time. The ISR payload may be
 * minutes old, and showing stale availability is how a customer ends up paying
 * for something that is gone (docs/ROUTES.md §4).
 */
export interface VariantAvailability {
  variantId: string;
  isDefault: boolean;
  pricePaise: number;
  mrpPaise: number;
  quantityAvailable: number | null;
  trackInventory: boolean;
  inStock: boolean;
}

export interface ProductAvailability {
  productId: string;
  /** False when the product itself is no longer publicly visible. */
  isPublished: boolean;
  inStock: boolean;
  variants: VariantAvailability[];
}

/**
 * Everything the cart needs to add a variant, read authoritatively from the
 * database.
 *
 * The cart NEVER trusts a client-supplied price, name or stock figure. This is the
 * single read that establishes what a variant actually costs and whether it can be
 * sold — at add-to-cart, at quote, and again at order creation
 * (docs/ARCHITECTURE.md §11.4).
 */
export interface PurchasableVariant {
  variantId: string;
  productId: string;
  productSlug: string;
  storeId: string;
  vendorId: string;
  categoryId: string;
  /** Resolved for the requested locale with English fallback. */
  productName: string;
  variantLabel: string | null;
  unitLabel: string | null;
  imageKey: string | null;
  pricePaise: number;
  mrpPaise: number;
  /** False when the product or variant is not publicly sellable. */
  isPurchasable: boolean;
  quantityAvailable: number | null;
  trackInventory: boolean;
  inStock: boolean;
  /** Store-level gate: a closed store cannot take orders. */
  storeAcceptingOrders: boolean;
  storeMinOrderPaise: number | null;
}

export interface ProductListFilters {
  categoryId?: string | undefined;
  /**
   * Matches any of these categories. Used by `/category/[slug]`, which must
   * include the products of child categories or a parent page looks empty.
   */
  categoryIds?: readonly string[] | undefined;
  /**
   * Restricts to specific products.
   *
   * Used by search, which resolves relevance in the search provider and then
   * hydrates through this repository — so locale fallback, stock derivation and
   * discount rules keep a single implementation. An EMPTY array matches nothing,
   * which is the honest reading of "these products" when there are none.
   */
  productIds?: readonly string[] | undefined;
  brandId?: string | undefined;
  status?: string | undefined;
  /** Restricts to products with sellable stock. */
  inStockOnly?: boolean | undefined;
  minPricePaise?: number | undefined;
  maxPricePaise?: number | undefined;
  search?: string | undefined;
}

export const PRODUCT_SORT_KEYS = ['createdAt', 'pricePaise', 'ratingAvg', 'soldCount'] as const;
export type ProductSortKey = (typeof PRODUCT_SORT_KEYS)[number];

export interface TranslationCompleteness {
  entity: string;
  locale: string;
  total: number;
  translated: number;
  missing: number;
}

/**
 * Read paths available to CUSTOMER-facing surfaces.
 *
 * Every method is locale-aware and returns only publicly visible rows — active,
 * not soft-deleted. There is no scope parameter because there is nothing tenant-
 * specific to leak here.
 */
export interface PublicCatalogReader {
  findProductBySlug(slug: string, locale: LocaleScope): Promise<LocalisedProduct | null>;

  listProducts(
    filters: ProductListFilters,
    locale: LocaleScope,
    page: CursorPage,
    sort?: string
  ): Promise<CursorResult<LocalisedProduct>>;

  /** Active categories as a 2-level tree, ordered by `displayOrder`. */
  listCategoryTree(locale: LocaleScope): Promise<CategoryTreeNode[]>;

  findCategoryBySlug(slug: string, locale: LocaleScope): Promise<CategoryDetail | null>;

  /** Full detail read for the product page: variants, images, store, SEO. */
  findProductDetailBySlug(
    slug: string,
    locale: LocaleScope
  ): Promise<LocalisedProductDetail | null>;

  /** Live price and stock. Deliberately uncached by the caller. */
  getProductAvailability(productId: string): Promise<ProductAvailability | null>;

  /**
   * Authoritative variant read for the cart.
   *
   * Returns null when the variant does not exist. Returns a row with
   * `isPurchasable: false` when it exists but cannot be sold, so the caller can
   * explain WHY rather than showing a bare "not found".
   */
  findPurchasableVariant(
    variantId: string,
    locale: LocaleScope
  ): Promise<PurchasableVariant | null>;

  /** Same-category products, excluding the product itself. */
  listRelatedProducts(
    productId: string,
    locale: LocaleScope,
    limit?: number
  ): Promise<LocalisedProduct[]>;

  /**
   * Every publicly indexable slug, for the sitemap.
   *
   * Locale-independent and translation-free on purpose: a sitemap needs slugs and
   * timestamps, not names, and joining the translation tables for a full-catalogue
   * scan would cost far more than it returns.
   *
   * `limit` is a hard cap. A sitemap file may hold 50,000 URLs, and every entry here
   * is emitted once per locale, so the real ceiling is half of that.
   */
  listSitemapEntries(limit?: number): Promise<SitemapEntries>;
}

/**
 * Per-entity cap for one sitemap.
 *
 * The XML sitemap limit is 50,000 URLs per file. Each entry is emitted once with
 * per-locale alternates, and there are two entity types plus static routes, so
 * 20,000 each leaves comfortable room before a sitemap index becomes necessary.
 */
export const SITEMAP_MAX_ENTRIES = 20_000;

/** Slugs and last-modified timestamps for the sitemap. */
export interface SitemapEntry {
  slug: string;
  updatedAt: Date;
}

export interface SitemapEntries {
  categories: SitemapEntry[];
  products: SitemapEntry[];
  /** True when the cap was hit, so the caller can report an incomplete sitemap. */
  isTruncated: boolean;
}

/**
 * Read/write paths available to a VENDOR.
 *
 * Every method takes a `VendorScope` and the implementation MUST include the
 * vendor id in the query predicate. This is the mechanism that makes cross-tenant
 * reads structurally impossible rather than merely forbidden by convention.
 */
export interface VendorCatalogRepository {
  listVendorProducts(
    scope: VendorScope,
    filters: ProductListFilters,
    locale: LocaleScope,
    page: OffsetPage,
    sort?: string
  ): Promise<OffsetResult<VendorProduct>>;

  findVendorProductById(
    scope: VendorScope,
    productId: string,
    locale: LocaleScope
  ): Promise<VendorProduct | null>;

  /**
   * Returns true only if the product belongs to the given vendor. Used before any
   * mutation so ownership is proven from the database, not inferred.
   */
  isProductOwnedByVendor(scope: VendorScope, productId: string): Promise<boolean>;

  countLowStockProducts(scope: VendorScope): Promise<number>;
}

/** Admin reads, unrestricted by tenant but still locale-aware. */
export interface AdminCatalogRepository {
  listAllProducts(
    scope: AdminScope,
    filters: ProductListFilters,
    locale: LocaleScope,
    page: OffsetPage,
    sort?: string
  ): Promise<OffsetResult<VendorProduct>>;

  /** Powers the admin translation-completeness dashboard (D-33). */
  getTranslationCompleteness(scope: AdminScope, locale: string): Promise<TranslationCompleteness[]>;
}

export interface CatalogRepository
  extends PublicCatalogReader, VendorCatalogRepository, AdminCatalogRepository {}
