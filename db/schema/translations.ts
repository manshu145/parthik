import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_helpers';
import { localeCode } from './enums';
import { users } from './identity';
import { blogPosts, cancellationReasons, cmsPages, faqs, seoMeta } from './cms';
import { brands, categories, productVariants, products } from './catalog';
import { banners, coupons } from './marketing';

/**
 * Localised content (docs/DATABASE.md §10.1, decision D-33).
 *
 * SIDE TRANSLATION TABLES, not `name_en`/`name_hi` columns. The reason is the
 * approved requirement that further Indian languages must not be blocked: adding
 * Marathi becomes INSERT statements, whereas suffixed columns would mean an ALTER
 * on every content table plus a rewrite of every query that selects a name.
 *
 * Rules enforced elsewhere:
 *   - the `en` row is MANDATORY for every translatable entity (service layer),
 *     because `en` is the fallback
 *   - per-field fallback to `en` is resolved in the REPOSITORY with COALESCE over
 *     a LEFT JOIN, so call sites can never forget it
 *   - slugs are NOT translated in V1; one canonical slug per entity
 */

/** Applied to every translation table. */
const translationTimestamps = {
  ...timestamps,
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
};

export const categoryTranslations = pgTable(
  'category_translations',
  {
    id: primaryId(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    locale: localeCode('locale').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    ...translationTimestamps,
  },
  (table) => [
    uniqueIndex('category_translations_key').on(table.categoryId, table.locale),
    // Completeness reporting: "what is missing in Hindi?"
    index('category_translations_locale_idx').on(table.locale),
  ]
);

export const brandTranslations = pgTable(
  'brand_translations',
  {
    id: primaryId(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    locale: localeCode('locale').notNull(),
    name: text('name').notNull(),
    ...translationTimestamps,
  },
  (table) => [
    uniqueIndex('brand_translations_key').on(table.brandId, table.locale),
    index('brand_translations_locale_idx').on(table.locale),
  ]
);

/**
 * Product text and its search vectors.
 *
 * ⚠️ DEVIATION FROM docs/DATABASE.md §5, deliberate and necessary:
 * the design places `search_vector_en`/`search_vector_hi` on `products`, but a
 * PostgreSQL generated column may only reference columns IN THE SAME ROW. The
 * text lives here, so the vectors must live here too — otherwise the migration
 * would simply fail.
 *
 * Both vectors are generated on every row: `search_vector_english` uses the
 * English stemmer, `search_vector_simple` uses no stemmer. Hindi queries use the
 * simple vector plus pg_trgm, because PostgreSQL ships no Hindi stemmer
 * (docs/ARCHITECTURE.md §16.7 C-2).
 */
export const productTranslations = pgTable(
  'product_translations',
  {
    id: primaryId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    locale: localeCode('locale').notNull(),
    name: text('name').notNull(),
    shortDescription: text('short_description'),
    description: text('description'),
    specifications: jsonb('specifications'),
    unitLabel: text('unit_label'),

    searchVectorEnglish: text('search_vector_english').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(name, '') || ' ' || coalesce(short_description, ''))`
    ),
    searchVectorSimple: text('search_vector_simple').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(short_description, ''))`
    ),

    ...translationTimestamps,
  },
  (table) => [
    uniqueIndex('product_translations_key').on(table.productId, table.locale),
    index('product_translations_locale_idx').on(table.locale),
    // Trigram matching on the name, which is what carries Hindi search.
    index('product_translations_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
    index('product_translations_search_en_idx').using('gin', table.searchVectorEnglish),
    index('product_translations_search_simple_idx').using('gin', table.searchVectorSimple),
  ]
);

export const productVariantTranslations = pgTable(
  'product_variant_translations',
  {
    id: primaryId(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    locale: localeCode('locale').notNull(),
    name: text('name').notNull(),
    variantLabel: text('variant_label'),
    ...translationTimestamps,
  },
  (table) => [
    uniqueIndex('product_variant_translations_key').on(table.variantId, table.locale),
    index('product_variant_translations_locale_idx').on(table.locale),
  ]
);

export const cmsPageTranslations = pgTable(
  'cms_page_translations',
  {
    id: primaryId(),
    cmsPageId: uuid('cms_page_id')
      .notNull()
      .references(() => cmsPages.id, { onDelete: 'cascade' }),
    locale: localeCode('locale').notNull(),
    title: text('title').notNull(),
    content: jsonb('content'),
    ...translationTimestamps,
  },
  (table) => [
    uniqueIndex('cms_page_translations_key').on(table.cmsPageId, table.locale),
    index('cms_page_translations_locale_idx').on(table.locale),
  ]
);

export const blogPostTranslations = pgTable(
  'blog_post_translations',
  {
    id: primaryId(),
    blogPostId: uuid('blog_post_id')
      .notNull()
      .references(() => blogPosts.id, { onDelete: 'cascade' }),
    locale: localeCode('locale').notNull(),
    title: text('title').notNull(),
    excerpt: text('excerpt'),
    content: jsonb('content'),
    ...translationTimestamps,
  },
  (table) => [
    uniqueIndex('blog_post_translations_key').on(table.blogPostId, table.locale),
    index('blog_post_translations_locale_idx').on(table.locale),
  ]
);

/** Images may differ per locale, so creative is translated too, not just copy. */
export const bannerTranslations = pgTable(
  'banner_translations',
  {
    id: primaryId(),
    bannerId: uuid('banner_id')
      .notNull()
      .references(() => banners.id, { onDelete: 'cascade' }),
    locale: localeCode('locale').notNull(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    ctaLabel: text('cta_label'),
    imageKey: text('image_key'),
    mobileImageKey: text('mobile_image_key'),
    ...translationTimestamps,
  },
  (table) => [
    uniqueIndex('banner_translations_key').on(table.bannerId, table.locale),
    index('banner_translations_locale_idx').on(table.locale),
  ]
);

export const faqTranslations = pgTable(
  'faq_translations',
  {
    id: primaryId(),
    faqId: uuid('faq_id')
      .notNull()
      .references(() => faqs.id, { onDelete: 'cascade' }),
    locale: localeCode('locale').notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    ...translationTimestamps,
  },
  (table) => [
    uniqueIndex('faq_translations_key').on(table.faqId, table.locale),
    index('faq_translations_locale_idx').on(table.locale),
  ]
);

export const couponTranslations = pgTable(
  'coupon_translations',
  {
    id: primaryId(),
    couponId: uuid('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'cascade' }),
    locale: localeCode('locale').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    ...translationTimestamps,
  },
  (table) => [
    uniqueIndex('coupon_translations_key').on(table.couponId, table.locale),
    index('coupon_translations_locale_idx').on(table.locale),
  ]
);

export const seoMetaTranslations = pgTable(
  'seo_meta_translations',
  {
    id: primaryId(),
    seoMetaId: uuid('seo_meta_id')
      .notNull()
      .references(() => seoMeta.id, { onDelete: 'cascade' }),
    locale: localeCode('locale').notNull(),
    metaTitle: text('meta_title'),
    metaDescription: text('meta_description'),
    ogTitle: text('og_title'),
    ogDescription: text('og_description'),
    ...translationTimestamps,
  },
  (table) => [
    uniqueIndex('seo_meta_translations_key').on(table.seoMetaId, table.locale),
    index('seo_meta_translations_locale_idx').on(table.locale),
  ]
);

export const cancellationReasonTranslations = pgTable(
  'cancellation_reason_translations',
  {
    id: primaryId(),
    reasonId: uuid('reason_id')
      .notNull()
      .references(() => cancellationReasons.id, { onDelete: 'cascade' }),
    locale: localeCode('locale').notNull(),
    label: text('label').notNull(),
    ...translationTimestamps,
  },
  (table) => [
    uniqueIndex('cancellation_reason_translations_key').on(table.reasonId, table.locale),
    index('cancellation_reason_translations_locale_idx').on(table.locale),
  ]
);
