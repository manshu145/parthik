import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  auditLogs,
  brandTranslations,
  brands,
  categories,
  categoryTranslations,
  deliveryZones,
  products,
  zonePincodes,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

export async function listAdminDeliveryZones() {
  const db = await getDb();
  return db
    .select({
      id: deliveryZones.id,
      name: deliveryZones.name,
      code: deliveryZones.code,
      city: deliveryZones.city,
      state: deliveryZones.state,
      isActive: deliveryZones.isActive,
      radiusKm: deliveryZones.radiusKm,
      baseDeliveryFeePaise: deliveryZones.baseDeliveryFeePaise,
      freeDeliveryThresholdPaise: deliveryZones.freeDeliveryThresholdPaise,
      minOrderPaise: deliveryZones.minOrderPaise,
      perKmFeePaise: deliveryZones.perKmFeePaise,
      maxDeliveryFeePaise: deliveryZones.maxDeliveryFeePaise,
      avgDeliveryMinutes: deliveryZones.avgDeliveryMinutes,
      pincodeCount: sql<number>`count(${zonePincodes.id}) filter (where ${zonePincodes.isActive} = true)::int`,
      pincodes: sql<
        string[]
      >`coalesce(array_agg(${zonePincodes.pincode} order by ${zonePincodes.pincode}) filter (where ${zonePincodes.isActive} = true), '{}')`,
    })
    .from(deliveryZones)
    .leftJoin(zonePincodes, eq(zonePincodes.deliveryZoneId, deliveryZones.id))
    .groupBy(deliveryZones.id)
    .orderBy(asc(deliveryZones.city), asc(deliveryZones.name));
}

export async function listAdminCategories() {
  const db = await getDb();
  return db
    .select({
      id: categories.id,
      parentId: categories.parentId,
      slug: categories.slug,
      name: categoryTranslations.name,
      description: categoryTranslations.description,
      displayOrder: categories.displayOrder,
      isActive: categories.isActive,
      isFeatured: categories.isFeatured,
      productCount: sql<number>`count(${products.id})::int`,
    })
    .from(categories)
    .innerJoin(
      categoryTranslations,
      sql`${categoryTranslations.categoryId} = ${categories.id} and ${categoryTranslations.locale} = 'en'`
    )
    .leftJoin(
      products,
      sql`${products.categoryId} = ${categories.id} and ${products.deletedAt} is null`
    )
    .where(sql`${categories.deletedAt} is null`)
    .groupBy(categories.id, categoryTranslations.name, categoryTranslations.description)
    .orderBy(asc(categories.displayOrder), asc(categoryTranslations.name));
}

export async function listAdminBrands() {
  const db = await getDb();
  return db
    .select({
      id: brands.id,
      slug: brands.slug,
      name: brandTranslations.name,
      isActive: brands.isActive,
      logoKey: brands.logoKey,
      productCount: sql<number>`count(${products.id})::int`,
    })
    .from(brands)
    .innerJoin(
      brandTranslations,
      sql`${brandTranslations.brandId} = ${brands.id} and ${brandTranslations.locale} = 'en'`
    )
    .leftJoin(products, sql`${products.brandId} = ${brands.id} and ${products.deletedAt} is null`)
    .where(sql`${brands.deletedAt} is null`)
    .groupBy(brands.id, brandTranslations.name)
    .orderBy(asc(brandTranslations.name));
}

export interface CategoryWriteInput {
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  displayOrder: number;
  isActive: boolean;
  isFeatured: boolean;
}

export interface BrandWriteInput {
  name: string;
  slug: string;
  logoKey: string | null;
  isActive: boolean;
}

export interface ZoneWriteInput {
  name: string;
  code: string;
  city: string;
  state: string;
  isActive: boolean;
  radiusKm: number | null;
  baseDeliveryFeePaise: number;
  freeDeliveryThresholdPaise: number | null;
  minOrderPaise: number;
  perKmFeePaise: number | null;
  maxDeliveryFeePaise: number | null;
  avgDeliveryMinutes: number | null;
  pincodes: string[];
}

export async function createAdminCategory(input: CategoryWriteInput, actorUserId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await assertCategorySlugAvailable(tx, input.slug);
    await assertCategoryParent(tx, input.parentId, null);

    const [created] = await tx
      .insert(categories)
      .values({
        parentId: input.parentId,
        slug: input.slug,
        displayOrder: input.displayOrder,
        isActive: input.isActive,
        isFeatured: input.isFeatured,
      })
      .returning({ id: categories.id });
    if (!created) throw new ConflictError('Could not create the category.');

    await tx.insert(categoryTranslations).values({
      categoryId: created.id,
      locale: 'en',
      name: input.name,
      description: input.description,
      updatedBy: actorUserId,
    });

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'CREATE',
      entityType: 'category',
      entityId: created.id,
      after: { slug: input.slug, name: input.name, isActive: input.isActive },
      changedFields: ['slug', 'name', 'parentId', 'displayOrder', 'isActive', 'isFeatured'],
      reason: 'Admin category created',
    });

    return created;
  });
}

export async function updateAdminCategory(
  id: string,
  input: CategoryWriteInput,
  actorUserId: string
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: categories.id,
        slug: categories.slug,
        parentId: categories.parentId,
        isActive: categories.isActive,
      })
      .from(categories)
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
      .limit(1);
    if (!before) throw new NotFoundError('Category not found.');

    await assertCategorySlugAvailable(tx, input.slug, id);
    await assertCategoryParent(tx, input.parentId, id);

    await tx
      .update(categories)
      .set({
        parentId: input.parentId,
        slug: input.slug,
        displayOrder: input.displayOrder,
        isActive: input.isActive,
        isFeatured: input.isFeatured,
        updatedAt: new Date(),
      })
      .where(eq(categories.id, id));

    await tx
      .insert(categoryTranslations)
      .values({
        categoryId: id,
        locale: 'en',
        name: input.name,
        description: input.description,
        updatedBy: actorUserId,
      })
      .onConflictDoUpdate({
        target: [categoryTranslations.categoryId, categoryTranslations.locale],
        set: {
          name: input.name,
          description: input.description,
          updatedBy: actorUserId,
          updatedAt: new Date(),
        },
      });

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entityType: 'category',
      entityId: id,
      before,
      after: { slug: input.slug, parentId: input.parentId, isActive: input.isActive },
      changedFields: [
        'slug',
        'name',
        'description',
        'parentId',
        'displayOrder',
        'isActive',
        'isFeatured',
      ],
      reason: 'Admin category updated',
    });

    return { id };
  });
}

export async function createAdminBrand(input: BrandWriteInput, actorUserId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await assertBrandSlugAvailable(tx, input.slug);

    const [created] = await tx
      .insert(brands)
      .values({ slug: input.slug, logoKey: input.logoKey, isActive: input.isActive })
      .returning({ id: brands.id });
    if (!created) throw new ConflictError('Could not create the brand.');

    await tx.insert(brandTranslations).values({
      brandId: created.id,
      locale: 'en',
      name: input.name,
      updatedBy: actorUserId,
    });

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'CREATE',
      entityType: 'brand',
      entityId: created.id,
      after: { slug: input.slug, name: input.name, isActive: input.isActive },
      changedFields: ['slug', 'name', 'logoKey', 'isActive'],
      reason: 'Admin brand created',
    });

    return created;
  });
}

export async function updateAdminBrand(id: string, input: BrandWriteInput, actorUserId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ id: brands.id, slug: brands.slug, isActive: brands.isActive })
      .from(brands)
      .where(and(eq(brands.id, id), isNull(brands.deletedAt)))
      .limit(1);
    if (!before) throw new NotFoundError('Brand not found.');

    await assertBrandSlugAvailable(tx, input.slug, id);

    await tx
      .update(brands)
      .set({
        slug: input.slug,
        logoKey: input.logoKey,
        isActive: input.isActive,
        updatedAt: new Date(),
      })
      .where(eq(brands.id, id));

    await tx
      .insert(brandTranslations)
      .values({ brandId: id, locale: 'en', name: input.name, updatedBy: actorUserId })
      .onConflictDoUpdate({
        target: [brandTranslations.brandId, brandTranslations.locale],
        set: { name: input.name, updatedBy: actorUserId, updatedAt: new Date() },
      });

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entityType: 'brand',
      entityId: id,
      before,
      after: { slug: input.slug, isActive: input.isActive },
      changedFields: ['slug', 'name', 'logoKey', 'isActive'],
      reason: 'Admin brand updated',
    });

    return { id };
  });
}

export async function createAdminDeliveryZone(input: ZoneWriteInput, actorUserId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await assertZoneCodeAvailable(tx, input.code);

    const [created] = await tx
      .insert(deliveryZones)
      .values({
        name: input.name,
        code: input.code,
        city: input.city,
        state: input.state,
        isActive: input.isActive,
        radiusKm: input.radiusKm,
        baseDeliveryFeePaise: input.baseDeliveryFeePaise,
        freeDeliveryThresholdPaise: input.freeDeliveryThresholdPaise,
        minOrderPaise: input.minOrderPaise,
        perKmFeePaise: input.perKmFeePaise,
        maxDeliveryFeePaise: input.maxDeliveryFeePaise,
        avgDeliveryMinutes: input.avgDeliveryMinutes,
      })
      .returning({ id: deliveryZones.id });
    if (!created) throw new ConflictError('Could not create the delivery zone.');

    await replaceZonePincodes(tx, created.id, input.pincodes);

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'CREATE',
      entityType: 'delivery_zone',
      entityId: created.id,
      after: {
        code: input.code,
        city: input.city,
        state: input.state,
        pincodes: input.pincodes.length,
      },
      changedFields: ['name', 'code', 'city', 'state', 'fees', 'pincodes', 'isActive'],
      reason: 'Admin delivery zone created',
    });

    return created;
  });
}

export async function updateAdminDeliveryZone(
  id: string,
  input: ZoneWriteInput,
  actorUserId: string
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: deliveryZones.id,
        code: deliveryZones.code,
        city: deliveryZones.city,
        state: deliveryZones.state,
        isActive: deliveryZones.isActive,
      })
      .from(deliveryZones)
      .where(eq(deliveryZones.id, id))
      .limit(1);
    if (!before) throw new NotFoundError('Delivery zone not found.');

    await assertZoneCodeAvailable(tx, input.code, id);

    await tx
      .update(deliveryZones)
      .set({
        name: input.name,
        code: input.code,
        city: input.city,
        state: input.state,
        isActive: input.isActive,
        radiusKm: input.radiusKm,
        baseDeliveryFeePaise: input.baseDeliveryFeePaise,
        freeDeliveryThresholdPaise: input.freeDeliveryThresholdPaise,
        minOrderPaise: input.minOrderPaise,
        perKmFeePaise: input.perKmFeePaise,
        maxDeliveryFeePaise: input.maxDeliveryFeePaise,
        avgDeliveryMinutes: input.avgDeliveryMinutes,
        updatedAt: new Date(),
      })
      .where(eq(deliveryZones.id, id));

    await replaceZonePincodes(tx, id, input.pincodes);

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entityType: 'delivery_zone',
      entityId: id,
      before,
      after: {
        code: input.code,
        city: input.city,
        state: input.state,
        isActive: input.isActive,
        pincodes: input.pincodes.length,
      },
      changedFields: ['name', 'code', 'city', 'state', 'fees', 'pincodes', 'isActive'],
      reason: 'Admin delivery zone updated',
    });

    return { id };
  });
}

async function assertCategorySlugAvailable(
  tx: Awaited<ReturnType<typeof getDb>>,
  slug: string,
  excludeId?: string
) {
  const predicates = [eq(categories.slug, slug), isNull(categories.deletedAt)];
  if (excludeId) predicates.push(ne(categories.id, excludeId));
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(...predicates))
    .limit(1);
  if (row) throw new ConflictError('That category slug is already in use.');
}

async function assertCategoryParent(
  tx: Awaited<ReturnType<typeof getDb>>,
  parentId: string | null,
  categoryId: string | null
) {
  if (!parentId) return;
  if (parentId === categoryId) throw new ValidationError('A category cannot be its own parent.');

  const [parent] = await tx
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(and(eq(categories.id, parentId), isNull(categories.deletedAt)))
    .limit(1);
  if (!parent) throw new ValidationError('Choose a valid parent category.');
  if (parent.parentId) throw new ValidationError('Categories can have at most two levels.');
}

async function assertBrandSlugAvailable(
  tx: Awaited<ReturnType<typeof getDb>>,
  slug: string,
  excludeId?: string
) {
  const predicates = [eq(brands.slug, slug), isNull(brands.deletedAt)];
  if (excludeId) predicates.push(ne(brands.id, excludeId));
  const [row] = await tx
    .select({ id: brands.id })
    .from(brands)
    .where(and(...predicates))
    .limit(1);
  if (row) throw new ConflictError('That brand slug is already in use.');
}

async function assertZoneCodeAvailable(
  tx: Awaited<ReturnType<typeof getDb>>,
  code: string,
  excludeId?: string
) {
  const predicates = [eq(deliveryZones.code, code)];
  if (excludeId) predicates.push(ne(deliveryZones.id, excludeId));
  const [row] = await tx
    .select({ id: deliveryZones.id })
    .from(deliveryZones)
    .where(and(...predicates))
    .limit(1);
  if (row) throw new ConflictError('That delivery zone code is already in use.');
}

async function replaceZonePincodes(
  tx: Awaited<ReturnType<typeof getDb>>,
  zoneId: string,
  values: string[]
) {
  const pincodes = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  for (const pincode of pincodes) {
    const [conflict] = await tx
      .select({ id: zonePincodes.id, deliveryZoneId: zonePincodes.deliveryZoneId })
      .from(zonePincodes)
      .where(and(eq(zonePincodes.pincode, pincode), eq(zonePincodes.isActive, true)))
      .limit(1);
    if (conflict && conflict.deliveryZoneId !== zoneId) {
      throw new ConflictError('Pincode ' + pincode + ' already belongs to another active zone.');
    }
  }

  await tx
    .update(zonePincodes)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(zonePincodes.deliveryZoneId, zoneId));

  for (const pincode of pincodes) {
    const [existing] = await tx
      .select({ id: zonePincodes.id })
      .from(zonePincodes)
      .where(and(eq(zonePincodes.deliveryZoneId, zoneId), eq(zonePincodes.pincode, pincode)))
      .orderBy(desc(zonePincodes.createdAt))
      .limit(1);

    if (existing) {
      await tx
        .update(zonePincodes)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(zonePincodes.id, existing.id));
    } else {
      await tx.insert(zonePincodes).values({ deliveryZoneId: zoneId, pincode, isActive: true });
    }
  }
}
