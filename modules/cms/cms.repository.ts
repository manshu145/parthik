import { and, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  cmsPageTranslations,
  cmsPages,
  redirects,
  seoMeta,
  seoMetaTranslations,
} from '@/db/schema';
import { defaultLocale } from '@/i18n/routing';
import type { LocaleScope, RepositoryContext } from '@/lib/db/repository';
import type { CmsRepository } from './cms.repository.types';
import type { CmsPage, CmsPageSummary, CmsPageType, RedirectRule } from './cms.types';

/**
 * CMS repository (Drizzle).
 *
 * The only file in this module permitted to import `@/db/schema` — enforced by the
 * ESLint import-boundary rules.
 *
 * Two things are applied here rather than left to callers, so they cannot be
 * forgotten: only PUBLISHED, non-deleted pages are ever returned, and locale
 * fallback to English is applied in SQL so no caller reimplements it (D-33).
 */
export class DrizzleCmsRepository implements CmsRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async findPublishedPage(slug: string, locale: LocaleScope): Promise<CmsPage | null> {
    const requested = alias(cmsPageTranslations, 'cpt_req');
    const fallback = alias(cmsPageTranslations, 'cpt_fb');
    const seoRequested = alias(seoMetaTranslations, 'seo_req');
    const seoFallback = alias(seoMetaTranslations, 'seo_fb');

    const rows = await this.ctx.db
      .select({
        id: cmsPages.id,
        slug: cmsPages.slug,
        pageType: cmsPages.pageType,
        updatedAt: cmsPages.updatedAt,
        title: sql<string | null>`coalesce(${requested.title}, ${fallback.title})`,
        content: sql<unknown>`coalesce(${requested.content}, ${fallback.content})`,
        // Reported so the UI can say the page is only available in English rather
        // than pretending it was translated.
        usedFallbackLocale: sql<boolean>`${requested.title} is null`,
        metaTitle: sql<
          string | null
        >`coalesce(${seoRequested.metaTitle}, ${seoFallback.metaTitle})`,
        metaDescription: sql<
          string | null
        >`coalesce(${seoRequested.metaDescription}, ${seoFallback.metaDescription})`,
        // No SEO row at all means indexable; only an explicit false excludes it.
        isIndexable: sql<boolean>`coalesce(${seoMeta.robotsIndex}, true)`,
      })
      .from(cmsPages)
      .leftJoin(
        requested,
        and(eq(requested.cmsPageId, cmsPages.id), eq(requested.locale, locale.locale))
      )
      .leftJoin(
        fallback,
        and(eq(fallback.cmsPageId, cmsPages.id), eq(fallback.locale, defaultLocale))
      )
      .leftJoin(seoMeta, eq(seoMeta.id, cmsPages.seoMetaId))
      .leftJoin(
        seoRequested,
        and(eq(seoRequested.seoMetaId, seoMeta.id), eq(seoRequested.locale, locale.locale))
      )
      .leftJoin(
        seoFallback,
        and(eq(seoFallback.seoMetaId, seoMeta.id), eq(seoFallback.locale, defaultLocale))
      )
      .where(
        and(
          eq(cmsPages.slug, slug),
          // A draft legal page must never be publicly readable.
          eq(cmsPages.status, 'PUBLISHED'),
          isNull(cmsPages.deletedAt)
        )
      )
      .limit(1);

    const row = rows[0];
    // A page with no translation in ANY locale has no title, so there is nothing to
    // render. Treated as missing rather than shown as a blank page.
    if (!row || !row.title) return null;

    return {
      id: row.id,
      slug: row.slug,
      pageType: row.pageType as CmsPageType,
      title: row.title,
      content: row.content ?? null,
      usedFallbackLocale: row.usedFallbackLocale,
      updatedAt: row.updatedAt,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      isIndexable: row.isIndexable,
    };
  }

  async listPublishedPages(): Promise<CmsPageSummary[]> {
    const rows = await this.ctx.db
      .select({
        slug: cmsPages.slug,
        updatedAt: cmsPages.updatedAt,
        // Both flags must allow it: an admin can keep a page indexable but hold it
        // out of the sitemap, and vice versa.
        isIndexable: sql<boolean>`coalesce(${seoMeta.robotsIndex} and ${seoMeta.includeInSitemap}, true)`,
      })
      .from(cmsPages)
      .leftJoin(seoMeta, eq(seoMeta.id, cmsPages.seoMetaId))
      .where(and(eq(cmsPages.status, 'PUBLISHED'), isNull(cmsPages.deletedAt)))
      .orderBy(cmsPages.slug);

    return rows;
  }

  async findRedirect(sourcePath: string): Promise<RedirectRule | null> {
    const rows = await this.ctx.db
      .select({
        sourcePath: redirects.sourcePath,
        targetPath: redirects.targetPath,
        statusCode: redirects.statusCode,
      })
      .from(redirects)
      .where(and(eq(redirects.sourcePath, sourcePath), eq(redirects.isActive, true)))
      .limit(1);

    return rows[0] ?? null;
  }
}

export function createCmsRepository(ctx: RepositoryContext): CmsRepository {
  return new DrizzleCmsRepository(ctx);
}
