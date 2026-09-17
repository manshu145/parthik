import { asc, eq, sql } from 'drizzle-orm';
import {
  brandTranslations,
  brands,
  categories,
  categoryTranslations,
  deliveryZones,
  products,
  zonePincodes,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';

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
