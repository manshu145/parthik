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

export interface ProductListFilters {
  categoryId?: string | undefined;
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
