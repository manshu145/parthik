import type { Locale } from '@/i18n/routing';
import type { CmsRepository } from './cms.repository.types';
import type { CmsPage, CmsPageSummary, RedirectRule } from './cms.types';

/**
 * CMS service.
 *
 * Owns the rules a route handler must not: which slugs are legitimate public pages,
 * and how a redirect target is validated before anyone is sent to it.
 */

export interface CmsServiceDeps {
  repository: CmsRepository;
}

/**
 * The single-segment public pages docs/ROUTES.md §3 defines.
 *
 * An ALLOW-LIST, not a free-for-all. Without it, `/[slug]` would answer for every
 * unmatched path, which means a typo, a stale link and a probe for `/wp-admin` would
 * all produce a rendered page rather than a 404 — and every one of those pages would
 * be indexable. The list is also what `generateStaticParams` needs to prerender.
 */
export const MARKETING_SLUGS = [
  'about',
  'contact',
  'faq',
  'careers',
  'blog',
  'privacy',
  'terms',
  'refund-policy',
  'shipping-policy',
  'cancellation-policy',
  'vendor-registration',
  'driver-registration',
] as const;

export type MarketingSlug = (typeof MARKETING_SLUGS)[number];

export function isMarketingSlug(slug: string): slug is MarketingSlug {
  return (MARKETING_SLUGS as readonly string[]).includes(slug);
}

export class CmsService {
  constructor(private readonly deps: CmsServiceDeps) {}

  getPage(slug: string, locale: Locale): Promise<CmsPage | null> {
    return this.deps.repository.findPublishedPage(slug, { locale });
  }

  /** Published pages that may appear in the sitemap. */
  async getSitemapPages(): Promise<CmsPageSummary[]> {
    const pages = await this.deps.repository.listPublishedPages();
    return pages.filter((page) => page.isIndexable);
  }

  /**
   * Resolves a managed redirect for a path that is about to 404.
   *
   * Returns null when there is no rule, or when the rule is unsafe. Two rules are
   * enforced here rather than trusted from the row:
   *
   *   1. The target must be a SITE-RELATIVE path. A redirects table that can point
   *      at `https://evil.example` is an open redirect with a CMS UI on top, and the
   *      admin who typed it may not have realised.
   *   2. A rule pointing at its own source is dropped, because following it is an
   *      immediate loop.
   */
  async resolveRedirect(path: string): Promise<RedirectRule | null> {
    const rule = await this.deps.repository.findRedirect(path);
    if (!rule) return null;

    if (!isSafeRedirectPath(rule.targetPath)) return null;
    if (rule.targetPath === rule.sourcePath) return null;

    return {
      ...rule,
      // Anything unexpected becomes a permanent redirect, which is what a slug
      // change means and what preserves ranking.
      statusCode: rule.statusCode === 302 || rule.statusCode === 307 ? 307 : 308,
    };
  }
}

/**
 * Whether a redirect target is safe to follow.
 *
 * Must start with a single `/`. `//evil.example` is a protocol-relative URL that
 * browsers treat as absolute, which is the classic open-redirect bypass, so it is
 * rejected explicitly rather than caught by the leading-slash check alone.
 */
export function isSafeRedirectPath(target: string): boolean {
  if (!target.startsWith('/')) return false;
  if (target.startsWith('//')) return false;
  // A backslash is normalised to a forward slash by some clients, so `/\evil.example`
  // is treated the same way as `//`.
  if (target.startsWith('/\\')) return false;

  return true;
}

export function createCmsService(deps: CmsServiceDeps): CmsService {
  return new CmsService(deps);
}
