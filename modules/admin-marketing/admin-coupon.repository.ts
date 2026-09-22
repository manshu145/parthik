import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  auditLogs,
  couponRestrictions,
  couponTranslations,
  coupons,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { ConflictError, NotFoundError } from '@/lib/errors';

export type AdminCouponType = 'FLAT' | 'PERCENTAGE' | 'FREE_DELIVERY';
export type AdminCouponScope = 'CART' | 'CATEGORY' | 'PRODUCT' | 'VENDOR' | 'DELIVERY';
export type AdminCouponRestrictionType = 'CATEGORY' | 'PRODUCT' | 'VENDOR' | 'ZONE' | 'USER';

export interface AdminCouponInput {
  code: string;
  couponType: AdminCouponType;
  discountValue: number;
  maxDiscountPaise: number | null;
  minCartPaise: number;
  scope: AdminCouponScope;
  firstOrderOnly: boolean;
  isUserSpecific: boolean;
  usageLimitTotal: number | null;
  usageLimitPerUser: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  isActive: boolean;
  isStackable: boolean;
  nameEn: string;
  descriptionEn: string | null;
  nameHi: string | null;
  descriptionHi: string | null;
  restrictions: Array<{
    restrictionType: AdminCouponRestrictionType;
    restrictionId: string;
  }>;
}

export async function listAdminCoupons(limit = 200) {
  const db = await getDb();
  const en = alias(couponTranslations, 'coupon_admin_en');
  const hi = alias(couponTranslations, 'coupon_admin_hi');

  const rows = await db
    .select({
      id: coupons.id,
      code: coupons.code,
      couponType: coupons.couponType,
      discountValue: coupons.discountValue,
      maxDiscountPaise: coupons.maxDiscountPaise,
      minCartPaise: coupons.minCartPaise,
      scope: coupons.scope,
      firstOrderOnly: coupons.firstOrderOnly,
      isUserSpecific: coupons.isUserSpecific,
      usageLimitTotal: coupons.usageLimitTotal,
      usageLimitPerUser: coupons.usageLimitPerUser,
      usedCount: coupons.usedCount,
      validFrom: coupons.validFrom,
      validUntil: coupons.validUntil,
      isActive: coupons.isActive,
      isStackable: coupons.isStackable,
      nameEn: en.name,
      descriptionEn: en.description,
      nameHi: hi.name,
      descriptionHi: hi.description,
      updatedAt: coupons.updatedAt,
    })
    .from(coupons)
    .leftJoin(en, and(eq(en.couponId, coupons.id), eq(en.locale, 'en')))
    .leftJoin(hi, and(eq(hi.couponId, coupons.id), eq(hi.locale, 'hi')))
    .where(isNull(coupons.deletedAt))
    .orderBy(asc(coupons.code))
    .limit(limit);

  const ids = rows.map((row) => row.id);
  const restrictionRows =
    ids.length > 0
      ? await db
          .select({
            couponId: couponRestrictions.couponId,
            restrictionType: couponRestrictions.restrictionType,
            restrictionId: couponRestrictions.restrictionId,
          })
          .from(couponRestrictions)
          .where(inArray(couponRestrictions.couponId, ids))
      : [];

  const grouped = new Map<string, typeof restrictionRows>();
  for (const restriction of restrictionRows) {
    const list = grouped.get(restriction.couponId) ?? [];
    list.push(restriction);
    grouped.set(restriction.couponId, list);
  }

  return rows.map((row) => ({
    ...row,
    restrictions: (grouped.get(row.id) ?? []).map((restriction) => ({
      restrictionType: restriction.restrictionType,
      restrictionId: restriction.restrictionId,
    })),
  }));
}

export async function createAdminCoupon(input: AdminCouponInput, actorUserId: string) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const code = input.code.trim().toUpperCase();
    const [existing] = await tx
      .select({ id: coupons.id })
      .from(coupons)
      .where(and(eq(coupons.code, code), isNull(coupons.deletedAt)))
      .limit(1);
    if (existing) throw new ConflictError('That coupon code already exists.');

    const [created] = await tx
      .insert(coupons)
      .values({
        code,
        couponType: input.couponType,
        discountValue: input.discountValue,
        maxDiscountPaise: input.maxDiscountPaise,
        minCartPaise: input.minCartPaise,
        scope: input.scope,
        firstOrderOnly: input.firstOrderOnly,
        isUserSpecific: input.isUserSpecific,
        usageLimitTotal: input.usageLimitTotal,
        usageLimitPerUser: input.usageLimitPerUser,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        isActive: input.isActive,
        isStackable: input.isStackable,
        createdBy: actorUserId,
      })
      .returning({ id: coupons.id });

    if (!created) throw new ConflictError('Could not create coupon.');

    await writeCouponTranslations(tx, created.id, input, actorUserId);
    await replaceRestrictions(tx, created.id, input.restrictions);

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'CREATE',
      entityType: 'coupon',
      entityId: created.id,
      after: {
        code,
        couponType: input.couponType,
        scope: input.scope,
        isActive: input.isActive,
        restrictionCount: input.restrictions.length,
      },
      changedFields: [
        'code',
        'couponType',
        'discountValue',
        'maxDiscountPaise',
        'minCartPaise',
        'scope',
        'eligibility',
        'limits',
        'validity',
        'isActive',
        'translations',
        'restrictions',
      ],
      reason: 'Admin coupon created',
    });

    return created;
  });
}

export async function updateAdminCoupon(
  id: string,
  input: AdminCouponInput,
  actorUserId: string
) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: coupons.id,
        code: coupons.code,
        couponType: coupons.couponType,
        scope: coupons.scope,
        isActive: coupons.isActive,
      })
      .from(coupons)
      .where(and(eq(coupons.id, id), isNull(coupons.deletedAt)))
      .limit(1);

    if (!before) throw new NotFoundError('Coupon not found.');

    const code = input.code.trim().toUpperCase();
    const [conflict] = await tx
      .select({ id: coupons.id })
      .from(coupons)
      .where(and(eq(coupons.code, code), ne(coupons.id, id), isNull(coupons.deletedAt)))
      .limit(1);
    if (conflict) throw new ConflictError('That coupon code already exists.');

    await tx
      .update(coupons)
      .set({
        code,
        couponType: input.couponType,
        discountValue: input.discountValue,
        maxDiscountPaise: input.maxDiscountPaise,
        minCartPaise: input.minCartPaise,
        scope: input.scope,
        firstOrderOnly: input.firstOrderOnly,
        isUserSpecific: input.isUserSpecific,
        usageLimitTotal: input.usageLimitTotal,
        usageLimitPerUser: input.usageLimitPerUser,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        isActive: input.isActive,
        isStackable: input.isStackable,
        updatedAt: new Date(),
      })
      .where(eq(coupons.id, id));

    await writeCouponTranslations(tx, id, input, actorUserId);
    await replaceRestrictions(tx, id, input.restrictions);

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entityType: 'coupon',
      entityId: id,
      before,
      after: {
        code,
        couponType: input.couponType,
        scope: input.scope,
        isActive: input.isActive,
        restrictionCount: input.restrictions.length,
      },
      changedFields: [
        'code',
        'couponType',
        'discountValue',
        'maxDiscountPaise',
        'minCartPaise',
        'scope',
        'eligibility',
        'limits',
        'validity',
        'isActive',
        'translations',
        'restrictions',
      ],
      reason: 'Admin coupon updated',
    });

    return { id };
  });
}

async function writeCouponTranslations(
  tx: Awaited<ReturnType<typeof getDb>>,
  couponId: string,
  input: AdminCouponInput,
  actorUserId: string
) {
  await tx
    .insert(couponTranslations)
    .values({
      couponId,
      locale: 'en',
      name: input.nameEn,
      description: input.descriptionEn,
      updatedBy: actorUserId,
    })
    .onConflictDoUpdate({
      target: [couponTranslations.couponId, couponTranslations.locale],
      set: {
        name: input.nameEn,
        description: input.descriptionEn,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      },
    });

  if (input.nameHi) {
    await tx
      .insert(couponTranslations)
      .values({
        couponId,
        locale: 'hi',
        name: input.nameHi,
        description: input.descriptionHi,
        updatedBy: actorUserId,
      })
      .onConflictDoUpdate({
        target: [couponTranslations.couponId, couponTranslations.locale],
        set: {
          name: input.nameHi,
          description: input.descriptionHi,
          updatedBy: actorUserId,
          updatedAt: new Date(),
        },
      });
  }
}

async function replaceRestrictions(
  tx: Awaited<ReturnType<typeof getDb>>,
  couponId: string,
  restrictions: AdminCouponInput['restrictions']
) {
  await tx.delete(couponRestrictions).where(eq(couponRestrictions.couponId, couponId));

  const unique = new Map<string, AdminCouponInput['restrictions'][number]>();
  for (const restriction of restrictions) {
    unique.set(restriction.restrictionType + ':' + restriction.restrictionId, restriction);
  }

  if (unique.size > 0) {
    await tx.insert(couponRestrictions).values(
      [...unique.values()].map((restriction) => ({
        couponId,
        restrictionType: restriction.restrictionType,
        restrictionId: restriction.restrictionId,
      }))
    );
  }
}
