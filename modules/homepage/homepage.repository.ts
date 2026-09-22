import { and, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  bannerTranslations,
  banners,
  homeLayouts,
  orders,
} from '@/db/schema';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import type { Locale } from '@/i18n/routing';

export type HomepageAudience = 'NEW_USERS' | 'RETURNING';
export type HomepageSectionType =
  | 'HERO_BANNERS'
  | 'FEATURED_CATEGORIES'
  | 'POPULAR_PRODUCTS'
  | 'COUPON_STRIP';

export interface HomepageSection {
  type: HomepageSectionType;
  title: string | null;
  visible: boolean;
  config: {
    limit?: number;
    placement?: 'HOME_HERO' | 'HOME_STRIP' | 'CATEGORY' | 'OFFERS';
  };
}

export interface HomepageBanner {
  id: string;
  placement: 'HOME_HERO' | 'HOME_STRIP' | 'CATEGORY' | 'OFFERS';
  linkUrl: string | null;
  priority: number;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  imageKey: string | null;
  mobileImageKey: string | null;
}

export const DEFAULT_HOMEPAGE_SECTIONS: HomepageSection[] = [
  {
    type: 'HERO_BANNERS',
    title: null,
    visible: true,
    config: { placement: 'HOME_HERO', limit: 4 },
  },
  {
    type: 'FEATURED_CATEGORIES',
    title: null,
    visible: true,
    config: { limit: 6 },
  },
  {
    type: 'POPULAR_PRODUCTS',
    title: null,
    visible: true,
    config: { limit: 10 },
  },
  {
    type: 'COUPON_STRIP',
    title: null,
    visible: true,
    config: { limit: 4 },
  },
];

export async function resolveHomepageAudience(userId: string | null): Promise<HomepageAudience> {
  if (!userId || !isDatabaseConfigured()) return 'NEW_USERS';

  const db = await getDb();
  const [existingOrder] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        inArray(orders.status, [
          'CONFIRMED',
          'ACCEPTED',
          'PREPARING',
          'READY_FOR_PICKUP',
          'ASSIGNED',
          'PICKED_UP',
          'OUT_FOR_DELIVERY',
          'DELIVERED',
          'REFUNDED',
          'RETURNED',
          'FAILED_DELIVERY',
        ])
      )
    )
    .limit(1);

  return existingOrder ? 'RETURNING' : 'NEW_USERS';
}

export async function getActiveHomepageSections(
  deliveryZoneId: string | null
): Promise<HomepageSection[]> {
  if (!isDatabaseConfigured()) return DEFAULT_HOMEPAGE_SECTIONS;

  const db = await getDb();
  const now = new Date();
  const zoneCondition = deliveryZoneId
    ? or(eq(homeLayouts.deliveryZoneId, deliveryZoneId), isNull(homeLayouts.deliveryZoneId))
    : isNull(homeLayouts.deliveryZoneId);

  const candidates = await db
    .select({
      deliveryZoneId: homeLayouts.deliveryZoneId,
      sections: homeLayouts.sections,
      updatedAt: homeLayouts.updatedAt,
    })
    .from(homeLayouts)
    .where(
      and(
        eq(homeLayouts.isActive, true),
        zoneCondition,
        or(isNull(homeLayouts.validFrom), lte(homeLayouts.validFrom, now)),
        or(isNull(homeLayouts.validUntil), gte(homeLayouts.validUntil, now))
      )
    )
    .orderBy(desc(homeLayouts.updatedAt));

  const chosen =
    (deliveryZoneId
      ? candidates.find((row) => row.deliveryZoneId === deliveryZoneId)
      : undefined) ?? candidates.find((row) => row.deliveryZoneId === null);

  return chosen ? parseSections(chosen.sections) : DEFAULT_HOMEPAGE_SECTIONS;
}

export async function listHomepageBanners(input: {
  locale: Locale;
  deliveryZoneId: string | null;
  audience: HomepageAudience;
}): Promise<HomepageBanner[]> {
  if (!isDatabaseConfigured()) return [];

  const db = await getDb();
  const requested = alias(bannerTranslations, 'banner_home_requested');
  const fallback = alias(bannerTranslations, 'banner_home_fallback');
  const now = new Date();

  const zoneCondition = input.deliveryZoneId
    ? or(eq(banners.deliveryZoneId, input.deliveryZoneId), isNull(banners.deliveryZoneId))
    : isNull(banners.deliveryZoneId);

  const rows = await db
    .select({
      id: banners.id,
      placement: banners.placement,
      linkUrl: banners.linkUrl,
      priority: banners.priority,
      titleRequested: requested.title,
      subtitleRequested: requested.subtitle,
      ctaRequested: requested.ctaLabel,
      imageRequested: requested.imageKey,
      mobileImageRequested: requested.mobileImageKey,
      titleFallback: fallback.title,
      subtitleFallback: fallback.subtitle,
      ctaFallback: fallback.ctaLabel,
      imageFallback: fallback.imageKey,
      mobileImageFallback: fallback.mobileImageKey,
    })
    .from(banners)
    .leftJoin(
      requested,
      and(eq(requested.bannerId, banners.id), eq(requested.locale, input.locale))
    )
    .leftJoin(fallback, and(eq(fallback.bannerId, banners.id), eq(fallback.locale, 'en')))
    .where(
      and(
        eq(banners.isActive, true),
        isNull(banners.deletedAt),
        or(eq(banners.targetAudience, 'ALL'), eq(banners.targetAudience, input.audience)),
        zoneCondition,
        or(isNull(banners.startsAt), lte(banners.startsAt, now)),
        or(isNull(banners.endsAt), gte(banners.endsAt, now))
      )
    )
    .orderBy(desc(banners.priority), desc(banners.updatedAt));

  return rows.flatMap((row) => {
    const title = row.titleRequested ?? row.titleFallback;
    if (!title) return [];

    return [
      {
        id: row.id,
        placement: row.placement,
        linkUrl: row.linkUrl,
        priority: row.priority,
        title,
        subtitle: row.subtitleRequested ?? row.subtitleFallback,
        ctaLabel: row.ctaRequested ?? row.ctaFallback,
        imageKey: row.imageRequested ?? row.imageFallback,
        mobileImageKey: row.mobileImageRequested ?? row.mobileImageFallback,
      },
    ];
  });
}

function parseSections(value: unknown): HomepageSection[] {
  if (!Array.isArray(value)) return DEFAULT_HOMEPAGE_SECTIONS;

  const allowed = new Set<HomepageSectionType>([
    'HERO_BANNERS',
    'FEATURED_CATEGORIES',
    'POPULAR_PRODUCTS',
    'COUPON_STRIP',
  ]);
  const result: HomepageSection[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;

    if (typeof row.type !== 'string' || !allowed.has(row.type as HomepageSectionType)) continue;

    const config =
      row.config && typeof row.config === 'object'
        ? (row.config as Record<string, unknown>)
        : {};
    const limit =
      typeof config.limit === 'number' && Number.isInteger(config.limit)
        ? Math.min(24, Math.max(1, config.limit))
        : undefined;
    const placement =
      typeof config.placement === 'string' &&
      ['HOME_HERO', 'HOME_STRIP', 'CATEGORY', 'OFFERS'].includes(config.placement)
        ? (config.placement as HomepageSection['config']['placement'])
        : undefined;

    result.push({
      type: row.type as HomepageSectionType,
      title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null,
      visible: row.visible !== false,
      config: {
        ...(limit ? { limit } : {}),
        ...(placement ? { placement } : {}),
      },
    });
  }

  return result.length > 0 ? result : DEFAULT_HOMEPAGE_SECTIONS;
}
