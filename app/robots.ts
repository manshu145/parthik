import type { MetadataRoute } from 'next';
import { getPublicAppUrl } from '@/lib/config/public-config';
import { isIndexableEnvironment } from '@/lib/config/env';

/**
 * robots.txt (master spec §20, docs/ROUTES.md §9).
 *
 * Private dashboard surfaces are never exposed to search engines, and non-production
 * deployments disallow everything so a preview URL cannot be indexed.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = getPublicAppUrl();

  if (!isIndexableEnvironment()) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
    };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/account',
          '/checkout',
          '/orders',
          '/favorites',
          '/vendor',
          '/driver',
          '/admin',
          '/api',
          // Search result pages are thin/duplicative and are noindex.
          '/search',
          '/login',
          // Hindi equivalents of the same private surfaces.
          '/hi/account',
          '/hi/checkout',
          '/hi/orders',
          '/hi/favorites',
          '/hi/vendor',
          '/hi/driver',
          '/hi/admin',
          '/hi/search',
          '/hi/login',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
