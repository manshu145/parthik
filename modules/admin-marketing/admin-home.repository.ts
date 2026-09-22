import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  auditLogs,
  bannerTranslations,
  banners,
  homeLayouts,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { ConflictError, NotFoundError } from '@/lib/errors';

export type AdminBannerPlacement = 'HOME_HERO' | 'HOME_STRIP' | 'CATEGORY' | 'OFFERS';
export type AdminBannerAudience = 'ALL' | 'NEW_USERS' | 'RETURNING';

export interface AdminBannerInput {
  placement: AdminBannerPlacement;
  linkUrl: string | null;
  targetAudience: AdminBannerAudience;
  deliveryZoneId: string | null;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  titleEn: string;
  subtitleEn: string | null;
  ctaLabelEn: string | null;
  imageKeyEn: string | null;
  mobileImageKeyEn: string | null;
  titleHi: string | null;
  subtitleHi: string | null;
  ctaLabelHi: string | null;
  imageKeyHi: string | null;
  mobileImageKeyHi: string | null;
}

export interface HomeSectionInput {
  type: 'HERO_BANNERS' | 'FEATURED_CATEGORIES' | 'POPULAR_PRODUCTS' | 'COUPON_STRIP';
  title: string | null;
  visible: boolean;
  config: {
    limit?: number;
    placement?: AdminBannerPlacement;
  };
}

export interface AdminHomeLayoutInput {
  name: string;
  isActive: boolean;
  deliveryZoneId: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  sections: HomeSectionInput[];
}

export async function listAdminBanners(limit = 200) {
  const db = await getDb();
  const en = alias(bannerTranslations, 'banner_admin_en');
  const hi = alias(bannerTranslations, 'banner_admin_hi');

  return db
    .select({
      id: banners.id,
      placement: banners.placement,
      linkUrl: banners.linkUrl,
      targetAudience: banners.targetAudience,
      deliveryZoneId: banners.deliveryZoneId,
      priority: banners.priority,
      startsAt: banners.startsAt,
      endsAt: banners.endsAt,
      isActive: banners.isActive,
      clickCount: banners.clickCount,
      impressionCount: banners.impressionCount,
      titleEn: en.title,
      subtitleEn: en.subtitle,
      ctaLabelEn: en.ctaLabel,
      imageKeyEn: en.imageKey,
      mobileImageKeyEn: en.mobileImageKey,
      titleHi: hi.title,
      subtitleHi: hi.subtitle,
      ctaLabelHi: hi.ctaLabel,
      imageKeyHi: hi.imageKey,
      mobileImageKeyHi: hi.mobileImageKey,
      updatedAt: banners.updatedAt,
    })
    .from(banners)
    .leftJoin(en, and(eq(en.bannerId, banners.id), eq(en.locale, 'en')))
    .leftJoin(hi, and(eq(hi.bannerId, banners.id), eq(hi.locale, 'hi')))
    .where(isNull(banners.deletedAt))
    .orderBy(desc(banners.priority), desc(banners.updatedAt))
    .limit(limit);
}

export async function createAdminBanner(input: AdminBannerInput, actorUserId: string) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(banners)
      .values({
        placement: input.placement,
        linkUrl: input.linkUrl,
        targetAudience: input.targetAudience,
        deliveryZoneId: input.deliveryZoneId,
        priority: input.priority,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        isActive: input.isActive,
        createdBy: actorUserId,
      })
      .returning({ id: banners.id });

    if (!created) throw new ConflictError('Could not create banner.');

    await writeBannerTranslations(tx, created.id, input, actorUserId);

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'CREATE',
      entityType: 'banner',
      entityId: created.id,
      after: {
        placement: input.placement,
        targetAudience: input.targetAudience,
        deliveryZoneId: input.deliveryZoneId,
        priority: input.priority,
        isActive: input.isActive,
      },
      changedFields: [
        'placement',
        'linkUrl',
        'targetAudience',
        'deliveryZoneId',
        'priority',
        'schedule',
        'translations',
        'isActive',
      ],
      reason: 'Admin banner created',
    });

    return created;
  });
}

export async function updateAdminBanner(
  id: string,
  input: AdminBannerInput,
  actorUserId: string
) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: banners.id,
        placement: banners.placement,
        targetAudience: banners.targetAudience,
        deliveryZoneId: banners.deliveryZoneId,
        priority: banners.priority,
        isActive: banners.isActive,
      })
      .from(banners)
      .where(and(eq(banners.id, id), isNull(banners.deletedAt)))
      .limit(1);

    if (!before) throw new NotFoundError('Banner not found.');

    await tx
      .update(banners)
      .set({
        placement: input.placement,
        linkUrl: input.linkUrl,
        targetAudience: input.targetAudience,
        deliveryZoneId: input.deliveryZoneId,
        priority: input.priority,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        isActive: input.isActive,
        updatedAt: new Date(),
      })
      .where(eq(banners.id, id));

    await writeBannerTranslations(tx, id, input, actorUserId);

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entityType: 'banner',
      entityId: id,
      before,
      after: {
        placement: input.placement,
        targetAudience: input.targetAudience,
        deliveryZoneId: input.deliveryZoneId,
        priority: input.priority,
        isActive: input.isActive,
      },
      changedFields: [
        'placement',
        'linkUrl',
        'targetAudience',
        'deliveryZoneId',
        'priority',
        'schedule',
        'translations',
        'isActive',
      ],
      reason: 'Admin banner updated',
    });

    return { id };
  });
}

export async function listAdminHomeLayouts(limit = 100) {
  const db = await getDb();

  return db
    .select({
      id: homeLayouts.id,
      name: homeLayouts.name,
      isActive: homeLayouts.isActive,
      sections: homeLayouts.sections,
      deliveryZoneId: homeLayouts.deliveryZoneId,
      validFrom: homeLayouts.validFrom,
      validUntil: homeLayouts.validUntil,
      version: homeLayouts.version,
      updatedAt: homeLayouts.updatedAt,
    })
    .from(homeLayouts)
    .orderBy(desc(homeLayouts.isActive), desc(homeLayouts.updatedAt))
    .limit(limit);
}

export async function createAdminHomeLayout(
  input: AdminHomeLayoutInput,
  actorUserId: string
) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    if (input.isActive) {
      await deactivateSiblingLayouts(tx, input.deliveryZoneId);
    }

    const [created] = await tx
      .insert(homeLayouts)
      .values({
        name: input.name,
        isActive: input.isActive,
        sections: input.sections,
        deliveryZoneId: input.deliveryZoneId,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        updatedBy: actorUserId,
      })
      .returning({ id: homeLayouts.id });

    if (!created) throw new ConflictError('Could not create homepage layout.');

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'CREATE',
      entityType: 'home_layout',
      entityId: created.id,
      after: {
        name: input.name,
        isActive: input.isActive,
        deliveryZoneId: input.deliveryZoneId,
        sectionCount: input.sections.length,
      },
      changedFields: ['name', 'isActive', 'deliveryZoneId', 'validity', 'sections'],
      reason: 'Homepage layout created',
    });

    return created;
  });
}

export async function updateAdminHomeLayout(
  id: string,
  input: AdminHomeLayoutInput,
  actorUserId: string
) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: homeLayouts.id,
        name: homeLayouts.name,
        isActive: homeLayouts.isActive,
        deliveryZoneId: homeLayouts.deliveryZoneId,
        version: homeLayouts.version,
      })
      .from(homeLayouts)
      .where(eq(homeLayouts.id, id))
      .limit(1);

    if (!before) throw new NotFoundError('Homepage layout not found.');

    if (input.isActive) {
      await deactivateSiblingLayouts(tx, input.deliveryZoneId, id);
    }

    await tx
      .update(homeLayouts)
      .set({
        name: input.name,
        isActive: input.isActive,
        sections: input.sections,
        deliveryZoneId: input.deliveryZoneId,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        version: before.version + 1,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      })
      .where(eq(homeLayouts.id, id));

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entityType: 'home_layout',
      entityId: id,
      before,
      after: {
        name: input.name,
        isActive: input.isActive,
        deliveryZoneId: input.deliveryZoneId,
        sectionCount: input.sections.length,
      },
      changedFields: ['name', 'isActive', 'deliveryZoneId', 'validity', 'sections', 'version'],
      reason: 'Homepage layout updated',
    });

    return { id };
  });
}

async function writeBannerTranslations(
  tx: Awaited<ReturnType<typeof getDb>>,
  bannerId: string,
  input: AdminBannerInput,
  actorUserId: string
) {
  await tx
    .insert(bannerTranslations)
    .values({
      bannerId,
      locale: 'en',
      title: input.titleEn,
      subtitle: input.subtitleEn,
      ctaLabel: input.ctaLabelEn,
      imageKey: input.imageKeyEn,
      mobileImageKey: input.mobileImageKeyEn,
      updatedBy: actorUserId,
    })
    .onConflictDoUpdate({
      target: [bannerTranslations.bannerId, bannerTranslations.locale],
      set: {
        title: input.titleEn,
        subtitle: input.subtitleEn,
        ctaLabel: input.ctaLabelEn,
        imageKey: input.imageKeyEn,
        mobileImageKey: input.mobileImageKeyEn,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      },
    });

  if (input.titleHi) {
    await tx
      .insert(bannerTranslations)
      .values({
        bannerId,
        locale: 'hi',
        title: input.titleHi,
        subtitle: input.subtitleHi,
        ctaLabel: input.ctaLabelHi,
        imageKey: input.imageKeyHi,
        mobileImageKey: input.mobileImageKeyHi,
        updatedBy: actorUserId,
      })
      .onConflictDoUpdate({
        target: [bannerTranslations.bannerId, bannerTranslations.locale],
        set: {
          title: input.titleHi,
          subtitle: input.subtitleHi,
          ctaLabel: input.ctaLabelHi,
          imageKey: input.imageKeyHi,
          mobileImageKey: input.mobileImageKeyHi,
          updatedBy: actorUserId,
          updatedAt: new Date(),
        },
      });
  }
}

async function deactivateSiblingLayouts(
  tx: Awaited<ReturnType<typeof getDb>>,
  deliveryZoneId: string | null,
  excludeId?: string
) {
  const siblingCondition =
    deliveryZoneId === null
      ? isNull(homeLayouts.deliveryZoneId)
      : eq(homeLayouts.deliveryZoneId, deliveryZoneId);

  const clauses = [siblingCondition, eq(homeLayouts.isActive, true)];
  if (excludeId) clauses.push(ne(homeLayouts.id, excludeId));

  await tx
    .update(homeLayouts)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(...clauses));
}
