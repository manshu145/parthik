import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  auditLogs,
  promotionRules,
  promotions,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

export type AdminPromotionType =
  | 'BUY_X_GET_Y'
  | 'CATEGORY_DISCOUNT'
  | 'VENDOR_CAMPAIGN'
  | 'FLASH_SALE'
  | 'FREE_DELIVERY'
  | 'NEW_CUSTOMER';

export interface AdminPromotionInput {
  name: string;
  promotionType: AdminPromotionType;
  description: string | null;
  bannerId: string | null;
  priority: number;
  validFrom: Date | null;
  validUntil: Date | null;
  isActive: boolean;
  zoneScope: string | null;
  rules: Array<{ ruleKey: string; ruleValue: unknown }>;
}

export async function listAdminPromotions(limit = 200) {
  const db = await getDb();
  const rows = await db
    .select({
      id: promotions.id,
      name: promotions.name,
      promotionType: promotions.promotionType,
      description: promotions.description,
      bannerId: promotions.bannerId,
      priority: promotions.priority,
      validFrom: promotions.validFrom,
      validUntil: promotions.validUntil,
      isActive: promotions.isActive,
      zoneScope: promotions.zoneScope,
      updatedAt: promotions.updatedAt,
    })
    .from(promotions)
    .where(isNull(promotions.deletedAt))
    .orderBy(desc(promotions.priority), desc(promotions.updatedAt))
    .limit(limit);

  const result = [];
  for (const row of rows) {
    const rules = await db
      .select({
        ruleKey: promotionRules.ruleKey,
        ruleValue: promotionRules.ruleValue,
      })
      .from(promotionRules)
      .where(eq(promotionRules.promotionId, row.id))
      .orderBy(asc(promotionRules.ruleKey));

    result.push({ ...row, rules });
  }
  return result;
}

export async function createAdminPromotion(
  input: AdminPromotionInput,
  actorUserId: string
) {
  assertActivationSupported(input);

  const db = await getDb();
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(promotions)
      .values({
        name: input.name,
        promotionType: input.promotionType,
        description: input.description,
        bannerId: input.bannerId,
        priority: input.priority,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        isActive: input.isActive,
        zoneScope: input.zoneScope,
        createdBy: actorUserId,
      })
      .returning({ id: promotions.id });

    if (!created) throw new ConflictError('Could not create promotion.');

    await replacePromotionRules(tx, created.id, input.rules);

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'CREATE',
      entityType: 'promotion',
      entityId: created.id,
      after: {
        name: input.name,
        promotionType: input.promotionType,
        isActive: input.isActive,
        zoneScope: input.zoneScope,
      },
      changedFields: [
        'name',
        'promotionType',
        'description',
        'bannerId',
        'priority',
        'validity',
        'zoneScope',
        'rules',
        'isActive',
      ],
      reason: 'Admin promotion created',
    });

    return created;
  });
}

export async function updateAdminPromotion(
  id: string,
  input: AdminPromotionInput,
  actorUserId: string
) {
  assertActivationSupported(input);

  const db = await getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: promotions.id,
        name: promotions.name,
        promotionType: promotions.promotionType,
        isActive: promotions.isActive,
        zoneScope: promotions.zoneScope,
      })
      .from(promotions)
      .where(and(eq(promotions.id, id), isNull(promotions.deletedAt)))
      .limit(1);

    if (!before) throw new NotFoundError('Promotion not found.');

    await tx
      .update(promotions)
      .set({
        name: input.name,
        promotionType: input.promotionType,
        description: input.description,
        bannerId: input.bannerId,
        priority: input.priority,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        isActive: input.isActive,
        zoneScope: input.zoneScope,
        updatedAt: new Date(),
      })
      .where(eq(promotions.id, id));

    await replacePromotionRules(tx, id, input.rules);

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entityType: 'promotion',
      entityId: id,
      before,
      after: {
        name: input.name,
        promotionType: input.promotionType,
        isActive: input.isActive,
        zoneScope: input.zoneScope,
      },
      changedFields: [
        'name',
        'promotionType',
        'description',
        'bannerId',
        'priority',
        'validity',
        'zoneScope',
        'rules',
        'isActive',
      ],
      reason: 'Admin promotion updated',
    });

    return { id };
  });
}

function assertActivationSupported(input: AdminPromotionInput) {
  if (input.isActive && input.promotionType !== 'FREE_DELIVERY') {
    throw new ValidationError(
      'Only FREE_DELIVERY promotions can be activated right now. Other promotion types stay draft-only until their pricing semantics are approved.'
    );
  }
}

async function replacePromotionRules(
  tx: Awaited<ReturnType<typeof getDb>>,
  promotionId: string,
  rules: AdminPromotionInput['rules']
) {
  await tx.delete(promotionRules).where(eq(promotionRules.promotionId, promotionId));

  const unique = new Map<string, AdminPromotionInput['rules'][number]>();
  for (const rule of rules) unique.set(rule.ruleKey, rule);

  if (unique.size > 0) {
    await tx.insert(promotionRules).values(
      [...unique.values()].map((rule) => ({
        promotionId,
        ruleKey: rule.ruleKey,
        ruleValue: rule.ruleValue,
      }))
    );
  }
}
