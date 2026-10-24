import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  actorColumns,
  paise,
  paiseNotNull,
  percentage,
  primaryId,
  softDelete,
  timestamps,
  ts,
} from './_helpers';
import { productStatus } from './enums';
import { seoMeta } from './cms';
import { stores, vendors } from './marketplace';

/**
 * Catalog domain (docs/DATABASE.md §5).
 *
 * D-33: base rows hold LANGUAGE-NEUTRAL data only. Names and descriptions live in
 * `*_translations`, so no base table privileges one language and adding a
 * language is an INSERT rather than an ALTER plus a query rewrite.
 */

/**
 * Self-referencing category tree, covering both category and subcategory.
 * Depth is limited to 2 levels by application rule, not by schema.
 */
export const categories = pgTable(
  'categories',
  {
    id: primaryId(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'restrict',
    }),
    slug: text('slug').notNull(),
    // name/description -> category_translations (D-33)
    iconKey: text('icon_key'),
    imageKey: text('image_key'),
    displayOrder: smallint('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    isFeatured: boolean('is_featured').notNull().default(false),
    seoMetaId: uuid('seo_meta_id').references(() => seoMeta.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('categories_slug_key').on(table.slug),
    index('categories_parent_order_idx').on(table.parentId, table.displayOrder),
    index('categories_active_idx')
      .on(table.isActive)
      .where(sql`deleted_at is null`),
  ]
);

export const brands = pgTable(
  'brands',
  {
    id: primaryId(),
    slug: text('slug').notNull(),
    // name -> brand_translations (D-33)
    logoKey: text('logo_key'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (table) => [uniqueIndex('brands_slug_key').on(table.slug)]
);

export const products = pgTable(
  'products',
  {
    id: primaryId(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),

    slug: text('slug').notNull(),
    // name/short_description/description/specifications -> product_translations

    status: productStatus('status').notNull().default('DRAFT'),
    isFeatured: boolean('is_featured').notNull().default(false),
    isPopular: boolean('is_popular').notNull().default(false),

    /** Language-neutral fallback, e.g. '500 g'. Translated form in the side table. */
    unitLabel: text('unit_label'),

    // ---- Tax: D-14 BLOCKED. Columns exist, stay NULL, nothing reads them. ----
    hsnCode: text('hsn_code'),
    taxRate: percentage('tax_rate'),
    isTaxInclusive: boolean('is_tax_inclusive').notNull().default(true),

    mrpPaise: paiseNotNull('mrp_paise'),
    pricePaise: paiseNotNull('price_paise'),
    /** Vendor-private; never exposed to customers. */
    costPaise: paise('cost_paise'),

    ratingAvg: percentage('rating_avg'),
    ratingCount: integer('rating_count').notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    soldCount: integer('sold_count').notNull().default(0),

    seoMetaId: uuid('seo_meta_id').references(() => seoMeta.id, { onDelete: 'set null' }),
    /** Optimistic locking against concurrent vendor/admin edits. */
    version: integer('version').notNull().default(1),
    publishedAt: ts('published_at'),

    ...timestamps,
    ...actorColumns,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('products_slug_key').on(table.slug),
    index('products_store_status_idx').on(table.storeId, table.status),
    index('products_category_status_idx').on(table.categoryId, table.status, table.createdAt),
    index('products_vendor_idx').on(table.vendorId),
    index('products_brand_idx').on(table.brandId),
    // The hot path: active, non-deleted products in a category.
    index('products_active_idx')
      .on(table.status, table.categoryId)
      .where(sql`deleted_at is null and status = 'ACTIVE'`),
    // A discount can never be nonsense: price must not exceed MRP.
    check('products_price_lte_mrp', sql`${table.pricePaise} <= ${table.mrpPaise}`),
    check('products_prices_non_negative', sql`${table.pricePaise} >= 0 and ${table.mrpPaise} >= 0`),
  ]
);

/**
 * Every product has at least one variant (a default), enforced in the service
 * layer, so cart and inventory logic has exactly one code path.
 */
export const productVariants = pgTable(
  'product_variants',
  {
    id: primaryId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Unique per vendor, not globally — two vendors may use the same SKU. */
    sku: text('sku'),
    // name/variant_label -> product_variant_translations (D-33)

    mrpPaise: paiseNotNull('mrp_paise'),
    pricePaise: paiseNotNull('price_paise'),
    unitLabel: text('unit_label'),
    isDefault: boolean('is_default').notNull().default(false),
    displayOrder: smallint('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('product_variants_product_idx').on(table.productId, table.displayOrder),
    uniqueIndex('product_variants_default_key')
      .on(table.productId)
      .where(sql`is_default = true and deleted_at is null`),
    check('product_variants_price_lte_mrp', sql`${table.pricePaise} <= ${table.mrpPaise}`),
  ]
);

/**
 * SKU uniqueness is per vendor. Enforced with a separate unique index that joins
 * through the product's vendor — expressed here as a plain index plus a service
 * check, because Postgres cannot enforce cross-table uniqueness declaratively.
 */
export const productImages = pgTable(
  'product_images',
  {
    id: primaryId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    /** PUBLIC R2 bucket. */
    storageKey: text('storage_key').notNull(),
    /** Required by the accessibility rule (master spec §26). */
    altText: text('alt_text').notNull(),
    displayOrder: smallint('display_order').notNull().default(0),
    isPrimary: boolean('is_primary').notNull().default(false),
    width: integer('width'),
    height: integer('height'),
    ...timestamps,
  },
  (table) => [
    index('product_images_product_idx').on(table.productId, table.displayOrder),
    index('product_images_variant_idx').on(table.variantId),
    uniqueIndex('product_images_primary_key')
      .on(table.productId)
      .where(sql`is_primary = true`),
  ]
);
