import type { MetadataRoute } from 'next';
import { defaultLocale, locales } from '@/i18n/routing';
import { getPublicAppUrl } from '@/lib/config/public-config';

/**
 * XML sitemap (master spec §20, docs/ROUTES.md §11).
 *
 * Bilingual from the start (D-33): each URL is listed once with `alternates` for
 * every locale, so Google receives correct hreflang signals.
 *
 * TASK 001 lists only the static routes that exist. Category, product, CMS and
 * blog entries are added by their own tasks, reading from the database.
 */

type StaticRoute = {
  path: string;
  changeFrequency: 'daily' | 'weekly' | 'monthly';
  priority: number;
};

/**
 * Only PUBLIC, indexable routes that actually exist.
 *
 * `/search` is excluded because it is `noindex` (thin, duplicative content), and
 * every `(customer)` route is excluded because private surfaces must never be
 * exposed to search engines.
 */
const STATIC_ROUTES: StaticRoute[] = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/categories', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/offers', changeFrequency: 'daily', priority: 0.8 },
];

/**
 * Builds a locale-correct URL; the default locale stays unprefixed (D-33a).
 *
 * The root needs care: English root is `/` (with the slash, so it is a valid
 * absolute URL) while a prefixed locale root is `/hi` (without a trailing slash,
 * matching what the router actually serves). Emitting an inconsistent form here
 * would produce canonical/hreflang mismatches.
 */
function localeUrl(baseUrl: string, locale: string, path: string): string {
  const prefix = locale === defaultLocale ? '' : `/${locale}`;

  if (path === '/') {
    return prefix ? `${baseUrl}${prefix}` : `${baseUrl}/`;
  }

  return `${baseUrl}${prefix}${path}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getPublicAppUrl();
  const lastModified = new Date();

  return STATIC_ROUTES.map((route) => ({
    url: localeUrl(baseUrl, defaultLocale, route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
    alternates: {
      languages: Object.fromEntries(
        locales.map((locale) => [
          locale === 'hi' ? 'hi-IN' : 'en-IN',
          localeUrl(baseUrl, locale, route.path),
        ])
      ),
    },
  }));
}
