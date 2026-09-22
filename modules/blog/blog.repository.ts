import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  auditLogs,
  blogPosts,
  blogPostTranslations,
  seoMeta,
  seoMetaTranslations,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { ConflictError, NotFoundError } from '@/lib/errors';
import type { Locale } from '@/i18n/routing';

export type BlogStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface AdminBlogInput {
  slug: string;
  coverImageKey: string | null;
  category: string | null;
  tags: string[];
  status: BlogStatus;
  titleEn: string;
  excerptEn: string | null;
  contentEn: unknown;
  titleHi: string | null;
  excerptHi: string | null;
  contentHi: unknown;
  metaTitleEn: string | null;
  metaDescriptionEn: string | null;
  metaTitleHi: string | null;
  metaDescriptionHi: string | null;
  robotsIndex: boolean;
  robotsFollow: boolean;
  includeInSitemap: boolean;
}

export async function listAdminBlogPosts(limit = 200) {
  const db = await getDb();
  const en = alias(blogPostTranslations, 'blog_admin_en');
  const hi = alias(blogPostTranslations, 'blog_admin_hi');
  const seoEn = alias(seoMetaTranslations, 'blog_seo_en');
  const seoHi = alias(seoMetaTranslations, 'blog_seo_hi');

  return db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      coverImageKey: blogPosts.coverImageKey,
      category: blogPosts.category,
      tags: blogPosts.tags,
      status: blogPosts.status,
      seoMetaId: blogPosts.seoMetaId,
      publishedAt: blogPosts.publishedAt,
      viewCount: blogPosts.viewCount,
      updatedAt: blogPosts.updatedAt,
      titleEn: en.title,
      excerptEn: en.excerpt,
      contentEn: en.content,
      titleHi: hi.title,
      excerptHi: hi.excerpt,
      contentHi: hi.content,
      metaTitleEn: seoEn.metaTitle,
      metaDescriptionEn: seoEn.metaDescription,
      metaTitleHi: seoHi.metaTitle,
      metaDescriptionHi: seoHi.metaDescription,
      robotsIndex: sql<boolean>`coalesce(${seoMeta.robotsIndex}, true)`,
      robotsFollow: sql<boolean>`coalesce(${seoMeta.robotsFollow}, true)`,
      includeInSitemap: sql<boolean>`coalesce(${seoMeta.includeInSitemap}, true)`,
    })
    .from(blogPosts)
    .leftJoin(en, and(eq(en.blogPostId, blogPosts.id), eq(en.locale, 'en')))
    .leftJoin(hi, and(eq(hi.blogPostId, blogPosts.id), eq(hi.locale, 'hi')))
    .leftJoin(seoMeta, eq(seoMeta.id, blogPosts.seoMetaId))
    .leftJoin(seoEn, and(eq(seoEn.seoMetaId, seoMeta.id), eq(seoEn.locale, 'en')))
    .leftJoin(seoHi, and(eq(seoHi.seoMetaId, seoMeta.id), eq(seoHi.locale, 'hi')))
    .where(isNull(blogPosts.deletedAt))
    .orderBy(desc(blogPosts.updatedAt))
    .limit(limit);
}

export async function createAdminBlogPost(input: AdminBlogInput, actorUserId: string) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    await assertBlogSlugAvailable(tx, input.slug);

    const now = new Date();
    const [created] = await tx
      .insert(blogPosts)
      .values({
        slug: input.slug,
        coverImageKey: input.coverImageKey,
        authorUserId: actorUserId,
        category: input.category,
        tags: input.tags,
        status: input.status,
        publishedAt: input.status === 'PUBLISHED' ? now : null,
      })
      .returning({ id: blogPosts.id });

    if (!created) throw new ConflictError('Could not create blog post.');

    const [seo] = await tx
      .insert(seoMeta)
      .values({
        entityType: 'blog_post',
        entityId: created.id,
        robotsIndex: input.robotsIndex,
        robotsFollow: input.robotsFollow,
        includeInSitemap: input.includeInSitemap,
      })
      .returning({ id: seoMeta.id });

    if (!seo) throw new ConflictError('Could not create blog SEO metadata.');

    await tx.update(blogPosts).set({ seoMetaId: seo.id }).where(eq(blogPosts.id, created.id));
    await writeBlogTranslations(tx, created.id, input, actorUserId);
    await writeBlogSeo(tx, seo.id, input, actorUserId);

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'CREATE',
      entityType: 'blog_post',
      entityId: created.id,
      after: { slug: input.slug, status: input.status, category: input.category },
      changedFields: ['slug', 'status', 'category', 'tags', 'coverImageKey', 'translations', 'seo'],
      reason: 'CMS blog post created',
    });

    return created;
  });
}

export async function updateAdminBlogPost(
  id: string,
  input: AdminBlogInput,
  actorUserId: string
) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: blogPosts.id,
        slug: blogPosts.slug,
        status: blogPosts.status,
        seoMetaId: blogPosts.seoMetaId,
        publishedAt: blogPosts.publishedAt,
      })
      .from(blogPosts)
      .where(and(eq(blogPosts.id, id), isNull(blogPosts.deletedAt)))
      .limit(1);

    if (!before) throw new NotFoundError('Blog post not found.');
    await assertBlogSlugAvailable(tx, input.slug, id);

    const now = new Date();
    await tx
      .update(blogPosts)
      .set({
        slug: input.slug,
        coverImageKey: input.coverImageKey,
        category: input.category,
        tags: input.tags,
        status: input.status,
        publishedAt:
          input.status === 'PUBLISHED' ? before.publishedAt ?? now : null,
        updatedAt: now,
      })
      .where(eq(blogPosts.id, id));

    let seoMetaId = before.seoMetaId;
    if (!seoMetaId) {
      const [seo] = await tx
        .insert(seoMeta)
        .values({
          entityType: 'blog_post',
          entityId: id,
          robotsIndex: input.robotsIndex,
          robotsFollow: input.robotsFollow,
          includeInSitemap: input.includeInSitemap,
        })
        .returning({ id: seoMeta.id });

      if (!seo) throw new ConflictError('Could not create blog SEO metadata.');
      seoMetaId = seo.id;
      await tx.update(blogPosts).set({ seoMetaId }).where(eq(blogPosts.id, id));
    } else {
      await tx
        .update(seoMeta)
        .set({
          robotsIndex: input.robotsIndex,
          robotsFollow: input.robotsFollow,
          includeInSitemap: input.includeInSitemap,
          updatedAt: now,
        })
        .where(eq(seoMeta.id, seoMetaId));
    }

    await writeBlogTranslations(tx, id, input, actorUserId);
    await writeBlogSeo(tx, seoMetaId, input, actorUserId);

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entityType: 'blog_post',
      entityId: id,
      before: { slug: before.slug, status: before.status },
      after: { slug: input.slug, status: input.status, category: input.category },
      changedFields: ['slug', 'status', 'category', 'tags', 'coverImageKey', 'translations', 'seo'],
      reason: 'CMS blog post updated',
    });

    return { id };
  });
}

export async function listPublishedBlogPosts(locale: Locale, limit = 100) {
  const db = await getDb();
  const requested = alias(blogPostTranslations, 'blog_public_requested');
  const fallback = alias(blogPostTranslations, 'blog_public_fallback');

  const rows = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      coverImageKey: blogPosts.coverImageKey,
      category: blogPosts.category,
      tags: blogPosts.tags,
      publishedAt: blogPosts.publishedAt,
      updatedAt: blogPosts.updatedAt,
      title: sql<string | null>`coalesce(${requested.title}, ${fallback.title})`,
      excerpt: sql<string | null>`coalesce(${requested.excerpt}, ${fallback.excerpt})`,
      usedFallbackLocale: sql<boolean>`${requested.title} is null`,
    })
    .from(blogPosts)
    .leftJoin(
      requested,
      and(eq(requested.blogPostId, blogPosts.id), eq(requested.locale, locale))
    )
    .leftJoin(
      fallback,
      and(eq(fallback.blogPostId, blogPosts.id), eq(fallback.locale, 'en'))
    )
    .where(
      and(
        eq(blogPosts.status, 'PUBLISHED'),
        isNull(blogPosts.deletedAt)
      )
    )
    .orderBy(desc(blogPosts.publishedAt), desc(blogPosts.updatedAt))
    .limit(limit);

  return rows
    .filter((row) => Boolean(row.title))
    .map((row) => ({ ...row, title: row.title! }));
}

export async function readPublishedBlogPost(slug: string, locale: Locale) {
  const db = await getDb();
  const requested = alias(blogPostTranslations, 'blog_detail_requested');
  const fallback = alias(blogPostTranslations, 'blog_detail_fallback');
  const seoRequested = alias(seoMetaTranslations, 'blog_detail_seo_requested');
  const seoFallback = alias(seoMetaTranslations, 'blog_detail_seo_fallback');

  const [row] = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      coverImageKey: blogPosts.coverImageKey,
      category: blogPosts.category,
      tags: blogPosts.tags,
      publishedAt: blogPosts.publishedAt,
      updatedAt: blogPosts.updatedAt,
      title: sql<string | null>`coalesce(${requested.title}, ${fallback.title})`,
      excerpt: sql<string | null>`coalesce(${requested.excerpt}, ${fallback.excerpt})`,
      content: sql<unknown>`coalesce(${requested.content}, ${fallback.content})`,
      usedFallbackLocale: sql<boolean>`${requested.title} is null`,
      metaTitle: sql<string | null>`coalesce(${seoRequested.metaTitle}, ${seoFallback.metaTitle})`,
      metaDescription: sql<string | null>`coalesce(${seoRequested.metaDescription}, ${seoFallback.metaDescription})`,
      robotsIndex: sql<boolean>`coalesce(${seoMeta.robotsIndex}, true)`,
    })
    .from(blogPosts)
    .leftJoin(
      requested,
      and(eq(requested.blogPostId, blogPosts.id), eq(requested.locale, locale))
    )
    .leftJoin(
      fallback,
      and(eq(fallback.blogPostId, blogPosts.id), eq(fallback.locale, 'en'))
    )
    .leftJoin(seoMeta, eq(seoMeta.id, blogPosts.seoMetaId))
    .leftJoin(
      seoRequested,
      and(eq(seoRequested.seoMetaId, seoMeta.id), eq(seoRequested.locale, locale))
    )
    .leftJoin(
      seoFallback,
      and(eq(seoFallback.seoMetaId, seoMeta.id), eq(seoFallback.locale, 'en'))
    )
    .where(
      and(
        eq(blogPosts.slug, slug),
        eq(blogPosts.status, 'PUBLISHED'),
        isNull(blogPosts.deletedAt)
      )
    )
    .limit(1);

  if (!row?.title) return null;
  return { ...row, title: row.title };
}

async function assertBlogSlugAvailable(
  tx: Awaited<ReturnType<typeof getDb>>,
  slug: string,
  excludeId?: string
) {
  const clauses = [eq(blogPosts.slug, slug), isNull(blogPosts.deletedAt)];
  if (excludeId) clauses.push(ne(blogPosts.id, excludeId));

  const [existing] = await tx
    .select({ id: blogPosts.id })
    .from(blogPosts)
    .where(and(...clauses))
    .limit(1);

  if (existing) throw new ConflictError('That blog slug is already in use.');
}

async function writeBlogTranslations(
  tx: Awaited<ReturnType<typeof getDb>>,
  blogPostId: string,
  input: AdminBlogInput,
  actorUserId: string
) {
  await tx
    .insert(blogPostTranslations)
    .values({
      blogPostId,
      locale: 'en',
      title: input.titleEn,
      excerpt: input.excerptEn,
      content: input.contentEn,
      updatedBy: actorUserId,
    })
    .onConflictDoUpdate({
      target: [blogPostTranslations.blogPostId, blogPostTranslations.locale],
      set: {
        title: input.titleEn,
        excerpt: input.excerptEn,
        content: input.contentEn,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      },
    });

  if (input.titleHi) {
    await tx
      .insert(blogPostTranslations)
      .values({
        blogPostId,
        locale: 'hi',
        title: input.titleHi,
        excerpt: input.excerptHi,
        content: input.contentHi,
        updatedBy: actorUserId,
      })
      .onConflictDoUpdate({
        target: [blogPostTranslations.blogPostId, blogPostTranslations.locale],
        set: {
          title: input.titleHi,
          excerpt: input.excerptHi,
          content: input.contentHi,
          updatedBy: actorUserId,
          updatedAt: new Date(),
        },
      });
  }
}

async function writeBlogSeo(
  tx: Awaited<ReturnType<typeof getDb>>,
  seoMetaId: string,
  input: AdminBlogInput,
  actorUserId: string
) {
  await tx
    .insert(seoMetaTranslations)
    .values({
      seoMetaId,
      locale: 'en',
      metaTitle: input.metaTitleEn,
      metaDescription: input.metaDescriptionEn,
      updatedBy: actorUserId,
    })
    .onConflictDoUpdate({
      target: [seoMetaTranslations.seoMetaId, seoMetaTranslations.locale],
      set: {
        metaTitle: input.metaTitleEn,
        metaDescription: input.metaDescriptionEn,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      },
    });

  if (input.titleHi || input.metaTitleHi || input.metaDescriptionHi) {
    await tx
      .insert(seoMetaTranslations)
      .values({
        seoMetaId,
        locale: 'hi',
        metaTitle: input.metaTitleHi,
        metaDescription: input.metaDescriptionHi,
        updatedBy: actorUserId,
      })
      .onConflictDoUpdate({
        target: [seoMetaTranslations.seoMetaId, seoMetaTranslations.locale],
        set: {
          metaTitle: input.metaTitleHi,
          metaDescription: input.metaDescriptionHi,
          updatedBy: actorUserId,
          updatedAt: new Date(),
        },
      });
  }
}
