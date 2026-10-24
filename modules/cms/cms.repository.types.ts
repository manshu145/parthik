import type { LocaleScope } from '@/lib/db/repository';
import type { CmsPage, CmsPageSummary, RedirectRule } from './cms.types';

/**
 * CMS persistence contract.
 *
 * Two implementations: Drizzle over Postgres, and an in-memory one so a
 * credential-free clone and the public preview still serve real pages.
 */
export interface CmsRepository {
  /**
   * A PUBLISHED page by slug, resolved for the locale with English fallback.
   *
   * Returns null for a draft or missing page. Drafts must never be publicly
   * readable — an unpublished legal page is worse than a 404.
   */
  findPublishedPage(slug: string, locale: LocaleScope): Promise<CmsPage | null>;

  /** Every published page, for the sitemap. */
  listPublishedPages(): Promise<CmsPageSummary[]>;

  /**
   * An ACTIVE redirect for a path, if one exists.
   *
   * Looked up only when a request is already going to 404, so the cost lands on the
   * miss path and never on a page that resolved normally.
   */
  findRedirect(sourcePath: string): Promise<RedirectRule | null>;
}
