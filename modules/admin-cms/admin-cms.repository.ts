import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  auditLogs,
  cmsPages,
  cmsPageTranslations,
  redirects,
  seoMeta,
  seoMetaTranslations,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { ConflictError, NotFoundError } from '@/lib/errors';

export type AdminCmsPageStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type AdminCmsPageType = 'LEGAL' | 'INFO' | 'LANDING';

export interface AdminCmsPageInput {
  slug: string;
  pageType: AdminCmsPageType;
  status: AdminCmsPageStatus;
  titleEn: string;
  titleHi: string | null;
  contentEn: unknown;
  contentHi: unknown;
  metaTitleEn: string | null;
  metaDescriptionEn: string | null;
  metaTitleHi: string | null;
  metaDescriptionHi: string | null;
  robotsIndex: boolean;
  robotsFollow: boolean;
  includeInSitemap: boolean;
}

export interface AdminRedirectInput {
  sourcePath: string;
  targetPath: string;
  statusCode: 301 | 302;
  isActive: boolean;
  note: string | null;
}

export async function listAdminCmsPages() {
  const db = await getDb();
  const en = alias(cmsPageTranslations, 'cms_admin_en');
  const hi = alias(cmsPageTranslations, 'cms_admin_hi');

  return db
    .select({
      id: cmsPages.id,
      slug: cmsPages.slug,
      pageType: cmsPages.pageType,
      status: cmsPages.status,
      version: cmsPages.version,
      publishedAt: cmsPages.publishedAt,
      updatedAt: cmsPages.updatedAt,
      titleEn: en.title,
      titleHi: hi.title,
    })
    .from(cmsPages)
    .leftJoin(en, and(eq(en.cmsPageId, cmsPages.id), eq(en.locale, 'en')))
    .leftJoin(hi, and(eq(hi.cmsPageId, cmsPages.id), eq(hi.locale, 'hi')))
    .where(isNull(cmsPages.deletedAt))
    .orderBy(asc(cmsPages.slug));
}

export async function getAdminCmsPage(id: string) {
  const db = await getDb();
  const [page] = await db
    .select({
      id: cmsPages.id,
      slug: cmsPages.slug,
      pageType: cmsPages.pageType,
      status: cmsPages.status,
      seoMetaId: cmsPages.seoMetaId,
      version: cmsPages.version,
      publishedAt: cmsPages.publishedAt,
      updatedAt: cmsPages.updatedAt,
    })
    .from(cmsPages)
    .where(and(eq(cmsPages.id, id), isNull(cmsPages.deletedAt)))
    .limit(1);

  if (!page) throw new NotFoundError('CMS page not found.');

  const translations = await db
    .select({
      locale: cmsPageTranslations.locale,
      title: cmsPageTranslations.title,
      content: cmsPageTranslations.content,
    })
    .from(cmsPageTranslations)
    .where(eq(cmsPageTranslations.cmsPageId, id));

  const seo = page.seoMetaId
    ? await db
        .select({
          id: seoMeta.id,
          robotsIndex: seoMeta.robotsIndex,
          robotsFollow: seoMeta.robotsFollow,
          includeInSitemap: seoMeta.includeInSitemap,
        })
        .from(seoMeta)
        .where(eq(seoMeta.id, page.seoMetaId))
        .limit(1)
    : [];

  const seoTranslations = page.seoMetaId
    ? await db
        .select({
          locale: seoMetaTranslations.locale,
          metaTitle: seoMetaTranslations.metaTitle,
          metaDescription: seoMetaTranslations.metaDescription,
        })
        .from(seoMetaTranslations)
        .where(eq(seoMetaTranslations.seoMetaId, page.seoMetaId))
    : [];

  const en = translations.find((row) => row.locale === 'en');
  const hi = translations.find((row) => row.locale === 'hi');
  const seoEn = seoTranslations.find((row) => row.locale === 'en');
  const seoHi = seoTranslations.find((row) => row.locale === 'hi');

  return {
    ...page,
    titleEn: en?.title ?? '',
    titleHi: hi?.title ?? null,
    contentEn: en?.content ?? [],
    contentHi: hi?.content ?? [],
    metaTitleEn: seoEn?.metaTitle ?? null,
    metaDescriptionEn: seoEn?.metaDescription ?? null,
    metaTitleHi: seoHi?.metaTitle ?? null,
    metaDescriptionHi: seoHi?.metaDescription ?? null,
    robotsIndex: seo[0]?.robotsIndex ?? true,
    robotsFollow: seo[0]?.robotsFollow ?? true,
    includeInSitemap: seo[0]?.includeInSitemap ?? true,
  };
}

export async function createAdminCmsPage(input: AdminCmsPageInput, actorUserId: string) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [conflict] = await tx
      .select({ id: cmsPages.id })
      .from(cmsPages)
      .where(and(eq(cmsPages.slug, input.slug), isNull(cmsPages.deletedAt)))
      .limit(1);
    if (conflict) throw new ConflictError('A CMS page with this slug already exists.');

    const now = new Date();
    const [created] = await tx
      .insert(cmsPages)
      .values({
        slug: input.slug,
        pageType: input.pageType,
        status: input.status,
        publishedAt: input.status === 'PUBLISHED' ? now : null,
        publishedBy: input.status === 'PUBLISHED' ? actorUserId : null,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning({ id: cmsPages.id });

    if (!created) throw new ConflictError('Could not create CMS page.');

    const [seo] = await tx
      .insert(seoMeta)
      .values({
        entityType: 'cms_page',
        entityId: created.id,
        robotsIndex: input.robotsIndex,
        robotsFollow: input.robotsFollow,
        includeInSitemap: input.includeInSitemap,
      })
      .returning({ id: seoMeta.id });

    if (!seo) throw new ConflictError('Could not create CMS SEO metadata.');

    await tx.update(cmsPages).set({ seoMetaId: seo.id }).where(eq(cmsPages.id, created.id));

    await writePageTranslations(tx, created.id, input, actorUserId);
    await writeSeoTranslations(tx, seo.id, input, actorUserId);

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'CREATE',
      entityType: 'cms_page',
      entityId: created.id,
      after: { slug: input.slug, status: input.status, pageType: input.pageType },
      changedFields: ['slug', 'pageType', 'status', 'translations', 'seo'],
      reason: 'CMS page created',
    });

    return created;
  });
}

export async function updateAdminCmsPage(
  id: string,
  input: AdminCmsPageInput,
  actorUserId: string
) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: cmsPages.id,
        slug: cmsPages.slug,
        status: cmsPages.status,
        pageType: cmsPages.pageType,
        seoMetaId: cmsPages.seoMetaId,
        version: cmsPages.version,
      })
      .from(cmsPages)
      .where(and(eq(cmsPages.id, id), isNull(cmsPages.deletedAt)))
      .limit(1);

    if (!before) throw new NotFoundError('CMS page not found.');

    const [slugConflict] = await tx
      .select({ id: cmsPages.id })
      .from(cmsPages)
      .where(and(eq(cmsPages.slug, input.slug), ne(cmsPages.id, id), isNull(cmsPages.deletedAt)))
      .limit(1);
    if (slugConflict) throw new ConflictError('A CMS page with this slug already exists.');

    const now = new Date();
    await tx
      .update(cmsPages)
      .set({
        slug: input.slug,
        pageType: input.pageType,
        status: input.status,
        publishedAt:
          input.status === 'PUBLISHED' ? (before.status === 'PUBLISHED' ? undefined : now) : null,
        publishedBy: input.status === 'PUBLISHED' ? actorUserId : null,
        version: before.version + 1,
        updatedBy: actorUserId,
        updatedAt: now,
      })
      .where(eq(cmsPages.id, id));

    let seoMetaId = before.seoMetaId;
    if (!seoMetaId) {
      const [createdSeo] = await tx
        .insert(seoMeta)
        .values({
          entityType: 'cms_page',
          entityId: id,
          robotsIndex: input.robotsIndex,
          robotsFollow: input.robotsFollow,
          includeInSitemap: input.includeInSitemap,
        })
        .returning({ id: seoMeta.id });
      if (!createdSeo) throw new ConflictError('Could not create CMS SEO metadata.');
      seoMetaId = createdSeo.id;
      await tx.update(cmsPages).set({ seoMetaId }).where(eq(cmsPages.id, id));
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

    await writePageTranslations(tx, id, input, actorUserId);
    await writeSeoTranslations(tx, seoMetaId, input, actorUserId);

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entityType: 'cms_page',
      entityId: id,
      before: { slug: before.slug, status: before.status, pageType: before.pageType },
      after: { slug: input.slug, status: input.status, pageType: input.pageType },
      changedFields: ['slug', 'pageType', 'status', 'translations', 'seo'],
      reason: 'CMS page updated',
    });

    return { id };
  });
}

export async function listAdminRedirects() {
  const db = await getDb();
  return db
    .select({
      id: redirects.id,
      sourcePath: redirects.sourcePath,
      targetPath: redirects.targetPath,
      statusCode: redirects.statusCode,
      isActive: redirects.isActive,
      hitCount: redirects.hitCount,
      lastHitAt: redirects.lastHitAt,
      note: redirects.note,
      updatedAt: redirects.updatedAt,
    })
    .from(redirects)
    .orderBy(desc(redirects.updatedAt));
}

export async function createAdminRedirect(input: AdminRedirectInput, actorUserId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: redirects.id })
      .from(redirects)
      .where(eq(redirects.sourcePath, input.sourcePath))
      .limit(1);
    if (existing) throw new ConflictError('A redirect for this source path already exists.');

    const [created] = await tx
      .insert(redirects)
      .values({ ...input, createdBy: actorUserId })
      .returning({ id: redirects.id });
    if (!created) throw new ConflictError('Could not create redirect.');

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'CREATE',
      entityType: 'redirect',
      entityId: created.id,
      after: input,
      changedFields: ['sourcePath', 'targetPath', 'statusCode', 'isActive', 'note'],
      reason: 'CMS redirect created',
    });
    return created;
  });
}

export async function updateAdminRedirect(
  id: string,
  input: AdminRedirectInput,
  actorUserId: string
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: redirects.id,
        sourcePath: redirects.sourcePath,
        targetPath: redirects.targetPath,
        statusCode: redirects.statusCode,
        isActive: redirects.isActive,
      })
      .from(redirects)
      .where(eq(redirects.id, id))
      .limit(1);
    if (!before) throw new NotFoundError('Redirect not found.');

    const [conflict] = await tx
      .select({ id: redirects.id })
      .from(redirects)
      .where(and(eq(redirects.sourcePath, input.sourcePath), ne(redirects.id, id)))
      .limit(1);
    if (conflict) throw new ConflictError('A redirect for this source path already exists.');

    await tx
      .update(redirects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(redirects.id, id));

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entityType: 'redirect',
      entityId: id,
      before,
      after: input,
      changedFields: ['sourcePath', 'targetPath', 'statusCode', 'isActive', 'note'],
      reason: 'CMS redirect updated',
    });
    return { id };
  });
}

async function writePageTranslations(
  tx: Awaited<ReturnType<typeof getDb>>,
  pageId: string,
  input: AdminCmsPageInput,
  actorUserId: string
) {
  await tx
    .insert(cmsPageTranslations)
    .values({
      cmsPageId: pageId,
      locale: 'en',
      title: input.titleEn,
      content: input.contentEn,
      updatedBy: actorUserId,
    })
    .onConflictDoUpdate({
      target: [cmsPageTranslations.cmsPageId, cmsPageTranslations.locale],
      set: {
        title: input.titleEn,
        content: input.contentEn,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      },
    });

  if (input.titleHi) {
    await tx
      .insert(cmsPageTranslations)
      .values({
        cmsPageId: pageId,
        locale: 'hi',
        title: input.titleHi,
        content: input.contentHi,
        updatedBy: actorUserId,
      })
      .onConflictDoUpdate({
        target: [cmsPageTranslations.cmsPageId, cmsPageTranslations.locale],
        set: {
          title: input.titleHi,
          content: input.contentHi,
          updatedBy: actorUserId,
          updatedAt: new Date(),
        },
      });
  }
}

async function writeSeoTranslations(
  tx: Awaited<ReturnType<typeof getDb>>,
  seoMetaId: string,
  input: AdminCmsPageInput,
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
