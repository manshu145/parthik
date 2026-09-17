import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  inventory,
  productTranslations,
  products,
  productVariants,
  stores,
  vendors,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';

export async function listAdminProducts(limit = 250) {
  const db = await getDb();
  return db
    .select({
      id: products.id,
      name: productTranslations.name,
      slug: products.slug,
      status: products.status,
      vendorName: vendors.businessName,
      storeName: stores.name,
      pricePaise: products.pricePaise,
      mrpPaise: products.mrpPaise,
      soldCount: products.soldCount,
      ratingAvg: products.ratingAvg,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .innerJoin(stores, eq(stores.id, products.storeId))
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, 'en'))
    )
    .where(and(isNull(products.deletedAt), isNull(vendors.deletedAt), isNull(stores.deletedAt)))
    .orderBy(desc(products.updatedAt), desc(products.id))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export async function listAdminInventory(limit = 500) {
  const db = await getDb();
  return db
    .select({
      inventoryId: inventory.id,
      productId: products.id,
      productName: productTranslations.name,
      productStatus: products.status,
      vendorName: vendors.businessName,
      storeName: stores.name,
      sku: productVariants.sku,
      unitLabel: productVariants.unitLabel,
      quantityAvailable: inventory.quantityAvailable,
      quantityReserved: inventory.quantityReserved,
      lowStockThreshold: inventory.lowStockThreshold,
      trackInventory: inventory.trackInventory,
      allowBackorder: inventory.allowBackorder,
      updatedAt: inventory.updatedAt,
    })
    .from(inventory)
    .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(vendors, eq(vendors.id, products.vendorId))
    .innerJoin(stores, eq(stores.id, inventory.storeId))
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, 'en'))
    )
    .where(
      and(
        isNull(products.deletedAt),
        isNull(productVariants.deletedAt),
        isNull(vendors.deletedAt),
        isNull(stores.deletedAt)
      )
    )
    .orderBy(asc(productTranslations.name), asc(productVariants.displayOrder))
    .limit(Math.min(Math.max(limit, 1), 1000));
}
