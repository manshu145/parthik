import type { Locale } from '@/i18n/routing';

/**
 * Cache keys and revalidation tags.
 *
 * THE RULE (docs/ARCHITECTURE.md §8): every cache key for user-visible content
 * includes BOTH locale and zone, composed as
 *
 *     v1:<entity>:<id>:<locale>:<zone>
 *
 * Omitting either is the bug that serves a Hindi page to an English visitor, or
 * quotes one zone's delivery fee to another zone's customer. Both are the kind of
 * fault that looks like a caching mystery rather than a missing key segment, so the
 * composition lives here and nothing builds these strings by hand.
 *
 * `v1:` is a manual kill switch: bumping it invalidates everything at once without
 * needing to enumerate keys.
 */

const VERSION = 'v1';

/** Stands in for the zone when no delivery location has been chosen. */
export const NO_ZONE = 'nozone';

export type CacheEntity =
  'category-tree' | 'category' | 'product' | 'product-list' | 'related' | 'home';

function normaliseSegment(value: string): string {
  // Colons would corrupt the key structure; whitespace makes keys hard to compare.
  return value.trim().replace(/[:\s]+/g, '-');
}

/**
 * A full cache key.
 *
 * `zone` is optional at the type level because some content genuinely does not
 * vary by zone (the category tree), but it must be passed explicitly as
 * `NO_ZONE` — an omitted argument is easy to do by accident, whereas naming the
 * absence is a decision.
 */
export function cacheKey(entity: CacheEntity, id: string, locale: Locale, zone: string): string {
  return [VERSION, entity, normaliseSegment(id), locale, normaliseSegment(zone)].join(':');
}

/**
 * Revalidation tag for an entity in one locale.
 *
 * Deliberately NOT zone-scoped: publishing a translation should invalidate that
 * content for every zone, and enumerating zones to revalidate would guarantee a
 * missed one.
 */
export function cacheTag(entity: CacheEntity, id: string, locale: Locale): string {
  return [entity, normaliseSegment(id), locale].join(':');
}

/** Coarse tag for an entire entity type, for bulk invalidation. */
export function cacheTagAll(entity: CacheEntity): string {
  return `${entity}:all`;
}

/**
 * Every tag a product page should be registered under.
 *
 * Bundled so a publish path cannot revalidate the product but forget the lists it
 * appears in — a stale price on a category page is just as wrong as on the detail
 * page.
 */
export function productCacheTags(productId: string, locale: Locale): string[] {
  return [
    cacheTag('product', productId, locale),
    cacheTagAll('product'),
    cacheTagAll('product-list'),
  ];
}

export function categoryCacheTags(categoryId: string, locale: Locale): string[] {
  return [
    cacheTag('category', categoryId, locale),
    cacheTagAll('category'),
    cacheTagAll('category-tree'),
    cacheTagAll('product-list'),
  ];
}
