import type { MetadataRoute } from 'next';
import { defaultLocale, locales, localeTags } from '@/i18n/routing';
import { logger } from '@/lib/logger';
import { canonicalUrl } from '@/lib/seo/metadata';
import { getCatalogService } from '@/modules/catalog';
import { getCmsService } from '@/modules/cms';

/**
 * XML sitemap (master spec §20, docs/ROUTES.md §11).
 *
 * Bilingual from the start (D-33): each URL is listed once, in the default locale,
 * with `alternates.languages` naming every locale plus `x-default`. Listing the same
 * page twice as two separate entries would compete with its own hreflang signals.
 *
 * DATABASE-DRIVEN. Categories and products come from the catalogue, so a new product
 * is discoverable without a code change. Only PUBLIC, indexable routes appear:
 * `/search` is `noindex` (thin, duplicative) and every private surface is excluded —
 * a sitemap that advertises `/account` is both useless and a disclosure.
 */

export const dynamic = 'force-dynamic';

/** How often a crawler should come back, per section. */
type ChangeFrequency = 'daily' | 'weekly' | 'monthly';

interface SitemapRoute {
  path: string;
  changeFrequency: ChangeFrequency;
  priority: number;
  lastModified: Date;
}

/**
 * Routes that exist as code and always have content.
 *
 * Marketing and legal pages are deliberately NOT here: they are CMS-driven, and a
 * page whose content has not been published yet is `noindex`. Listing it would ask
 * Google to crawl a page we are simultaneously telling it to ignore. They join the
 * sitemap from `cms_pages` the moment they are published.
 */
const STATIC_ROUTES: Array<Omit<SitemapRoute, 'lastModified'>> = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/categories', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/offers', changeFrequency: 'daily', priority: 0.8 },
];

/** One sitemap entry with a full set of hreflang alternates. */
function entry(route: SitemapRoute): MetadataRoute.Sitemap[number] {
  const languages: Record<string, string> = {};

  for (const locale of locales) {
    languages[localeTags[locale]] = canonicalUrl(route.path, locale);
  }
  // Same as the page metadata: omitting x-default makes Google guess.
  languages['x-default'] = canonicalUrl(route.path, defaultLocale);

  return {
    url: canonicalUrl(route.path, defaultLocale),
    lastModified: route.lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
    alternates: { languages },
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const generatedAt = new Date();
  const staticEntries = STATIC_ROUTES.map((route) =>
    entry({ ...route, lastModified: generatedAt })
  );

  let catalogEntries: MetadataRoute.Sitemap = [];

  try {
    const catalog = await getCatalogService();
    const { categories, products, isTruncated } = await catalog.getSitemapEntries();

    if (isTruncated) {
      // A silently truncated sitemap means pages that will never be crawled. When
      // this fires, the fix is a sitemap index, not a bigger cap.
      logger.warn('Sitemap truncated at the per-entity cap — a sitemap index is now needed', {
        categories: categories.length,
        products: products.length,
      });
    }

    catalogEntries = [
      ...categories.map((category) =>
        entry({
          path: `/category/${category.slug}`,
          changeFrequency: 'weekly',
          priority: 0.7,
          lastModified: category.updatedAt,
        })
      ),
      ...products.map((product) =>
        entry({
          path: `/products/${product.slug}`,
          changeFrequency: 'weekly',
          priority: 0.6,
          lastModified: product.updatedAt,
        })
      ),
    ];
  } catch (error) {
    // A catalogue outage must not produce a 500 at /sitemap.xml. An empty or
    // partial sitemap is re-crawled; an error response can get the whole file
    // dropped from the index.
    logger.exception(error, { route: '/sitemap.xml' });
  }

  let cmsEntries: MetadataRoute.Sitemap = [];

  try {
    const cms = await getCmsService();
    const pages = await cms.getSitemapPages();

    cmsEntries = pages.map((cmsPage) =>
      entry({
        path: `/${cmsPage.slug}`,
        changeFrequency: 'monthly',
        priority: 0.4,
        lastModified: cmsPage.updatedAt,
      })
    );
  } catch (error) {
    // Same reasoning as the catalogue: degrade, do not fail.
    logger.exception(error, { route: '/sitemap.xml' });
  }

  return [...staticEntries, ...catalogEntries, ...cmsEntries];
}
