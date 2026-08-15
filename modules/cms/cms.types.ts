/**
 * CMS contracts (docs/DATABASE.md §10, master spec §19, D-30).
 *
 * The CMS is database-driven so legal and marketing copy changes without a deploy.
 * These are the read shapes the public pages need; authoring is TASK 016.
 */

/** Mirrors the `cms_page_type` enum. */
export type CmsPageType = 'LEGAL' | 'INFO' | 'LANDING';

/**
 * A published CMS page, resolved for one locale.
 *
 * `content` is deliberately `unknown`: the column is `jsonb` and the authoring
 * format is TASK 016's decision. Typing it now would freeze a shape nobody has
 * agreed, so the renderer narrows it at the edge instead.
 */
export interface CmsPage {
  id: string;
  slug: string;
  pageType: CmsPageType;
  title: string;
  content: unknown;
  /** True when the requested locale had no translation and English was used (D-33). */
  usedFallbackLocale: boolean;
  updatedAt: Date;
  /** Authored SEO copy, when an admin has set it. */
  metaTitle: string | null;
  metaDescription: string | null;
  /** Honours `seo_meta.is_indexable`; a draft-quality page can be excluded. */
  isIndexable: boolean;
}

/** A published page, for the sitemap and internal linking. */
export interface CmsPageSummary {
  slug: string;
  updatedAt: Date;
  isIndexable: boolean;
}

/**
 * A managed redirect (master spec §20).
 *
 * Slug changes write a row here so links and rankings survive a rename
 * (docs/ROUTES.md §11).
 */
export interface RedirectRule {
  sourcePath: string;
  targetPath: string;
  /** 301 permanent or 302 temporary. Anything else is treated as 301. */
  statusCode: number;
}
