import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorColumns, primaryId, softDelete, timestamps, ts } from './_helpers';
import { cmsPageType, contentStatus, localeCode } from './enums';
import { users } from './identity';
import { deliveryZones } from './location';

/**
 * CMS, SEO and localisation infrastructure (docs/DATABASE.md §10).
 *
 * D-30: the CMS is database-driven and managed inside the admin dashboard, so
 * legal pages, banners and the homepage layout change without a deploy.
 */

/**
 * Admin-visible locale lookup (D-33).
 *
 * Paired with the `locale_code` enum: the enum gives referential integrity on
 * every translation table, this table gives admins a place to see and label the
 * supported set. Adding a language means extending both.
 */
export const supportedLocales = pgTable(
  'supported_locales',
  {
    id: primaryId(),
    code: localeCode('code').notNull(),
    name: text('name').notNull(),
    /** Shown in the language switcher, in its own script. */
    nativeName: text('native_name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    displayOrder: smallint('display_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('supported_locales_code_key').on(table.code),
    // Exactly one default locale, enforced by the database rather than by hope.
    uniqueIndex('supported_locales_single_default_key')
      .on(table.isDefault)
      .where(sql`is_default = true`),
  ]
);

/**
 * SEO metadata, shared by products, categories, CMS pages and blog posts.
 *
 * Locale-specific text lives in `seo_meta_translations`; this row holds the
 * language-neutral directives.
 */
export const seoMeta = pgTable(
  'seo_meta',
  {
    id: primaryId(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),

    canonicalUrl: text('canonical_url'),
    ogImageKey: text('og_image_key'),
    twitterCard: text('twitter_card'),
    schemaType: text('schema_type'),
    robotsIndex: boolean('robots_index').notNull().default(true),
    robotsFollow: boolean('robots_follow').notNull().default(true),
    includeInSitemap: boolean('include_in_sitemap').notNull().default(true),

    ...timestamps,
  },
  (table) => [uniqueIndex('seo_meta_entity_key').on(table.entityType, table.entityId)]
);

export const cmsPages = pgTable(
  'cms_pages',
  {
    id: primaryId(),
    slug: text('slug').notNull(),
    pageType: cmsPageType('page_type').notNull().default('INFO'),
    status: contentStatus('status').notNull().default('DRAFT'),
    seoMetaId: uuid('seo_meta_id').references(() => seoMeta.id, { onDelete: 'set null' }),

    publishedAt: ts('published_at'),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),

    ...timestamps,
    ...actorColumns,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('cms_pages_slug_key').on(table.slug),
    index('cms_pages_status_idx')
      .on(table.status)
      .where(sql`deleted_at is null`),
  ]
);

export const blogPosts = pgTable(
  'blog_posts',
  {
    id: primaryId(),
    slug: text('slug').notNull(),
    coverImageKey: text('cover_image_key'),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    category: text('category'),
    tags: jsonb('tags'),
    status: contentStatus('status').notNull().default('DRAFT'),
    seoMetaId: uuid('seo_meta_id').references(() => seoMeta.id, { onDelete: 'set null' }),
    publishedAt: ts('published_at'),
    viewCount: integer('view_count').notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('blog_posts_slug_key').on(table.slug),
    index('blog_posts_status_idx')
      .on(table.status, table.publishedAt)
      .where(sql`deleted_at is null`),
  ]
);

/**
 * The mechanism that makes the homepage CMS-driven (master spec §9).
 *
 * `sections` is an ordered array of typed descriptors — `{ type, title, config,
 * visible }` — so admin can reorder and toggle homepage sections without a
 * deploy. Only one active layout per zone at a time.
 */
export const homeLayouts = pgTable(
  'home_layouts',
  {
    id: primaryId(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    sections: jsonb('sections').notNull(),
    deliveryZoneId: uuid('delivery_zone_id').references(() => deliveryZones.id, {
      onDelete: 'cascade',
    }),
    validFrom: ts('valid_from'),
    validUntil: ts('valid_until'),
    version: integer('version').notNull().default(1),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    // One active layout per zone. The partial unique index covers the global
    // (zone-less) layout too, since NULL zone rows collide on the same predicate.
    uniqueIndex('home_layouts_active_zone_key')
      .on(table.deliveryZoneId)
      .where(sql`is_active = true`),
    index('home_layouts_active_idx').on(table.isActive),
  ]
);

/**
 * 301/302 manager. Protects SEO across slug changes and the eventual legacy-site
 * cutover (master spec §20, D-31).
 */
export const redirects = pgTable(
  'redirects',
  {
    id: primaryId(),
    sourcePath: text('source_path').notNull(),
    targetPath: text('target_path').notNull(),
    statusCode: smallint('status_code').notNull().default(301),
    isActive: boolean('is_active').notNull().default(true),
    hitCount: integer('hit_count').notNull().default(0),
    lastHitAt: ts('last_hit_at'),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('redirects_source_key').on(table.sourcePath),
    index('redirects_active_idx').on(table.isActive),
  ]
);

/**
 * Cancellation reason lookup.
 *
 * ⚠️ NOTE: docs/DATABASE.md §10.1 defines `cancellation_reason_translations` with
 * a `reason_id` but never defines the base table it points at. This is the
 * minimal structural table that translation table requires — codes and labels
 * only, no policy semantics. **No rows are seeded**, because the actual reason
 * list is a business decision that has not been made (related to open item
 * D-19a). Flagged for confirmation rather than invented.
 */
export const cancellationReasons = pgTable(
  'cancellation_reasons',
  {
    id: primaryId(),
    code: text('code').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    displayOrder: smallint('display_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex('cancellation_reasons_code_key').on(table.code)]
);

export const faqs = pgTable(
  'faqs',
  {
    id: primaryId(),
    category: text('category'),
    displayOrder: smallint('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [index('faqs_category_idx').on(table.category, table.displayOrder)]
);
