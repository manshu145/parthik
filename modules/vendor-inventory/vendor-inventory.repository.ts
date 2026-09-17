import { and, asc, eq, isNull } from 'drizzle-orm';
import { inventory, productTranslations, products, productVariants, stores } from '@/db/schema';
import { getDb } from '@/lib/db/client';

export interface VendorInventoryItem {
  inventoryId: string;
  productId: string;
  productName: string;
  productSlug: string;
  productStatus: (typeof products.$inferSelect)['status'];
  variantId: string;
  sku: string | null;
  unitLabel: string | null;
  storeId: string;
  storeName: string;
  quantityAvailable: number;
  quantityReserved: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  allowBackorder: boolean;
  updatedAt: Date;
}

/**
 * Vendor-owned stock projection.
 *
 * Tenant isolation is enforced in the repository by `products.vendorId`; callers cannot widen
 * this query with a store id or variant id. English product text is used as the guaranteed
 * translation fallback (D-33) so the operational inventory table always has a stable label.
 */
export async function listVendorInventory(
  vendorId: string,
  limit = 200
): Promise<VendorInventoryItem[]> {
  const db = await getDb();

  return db
    .select({
      inventoryId: inventory.id,
      productId: products.id,
      productName: productTranslations.name,
      productSlug: products.slug,
      productStatus: products.status,
      variantId: productVariants.id,
      sku: productVariants.sku,
      unitLabel: productVariants.unitLabel,
      storeId: stores.id,
      storeName: stores.name,
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
    .innerJoin(stores, eq(stores.id, inventory.storeId))
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, 'en'))
    )
    .where(
      and(
        eq(products.vendorId, vendorId),
        isNull(products.deletedAt),
        isNull(productVariants.deletedAt),
        isNull(stores.deletedAt)
      )
    )
    .orderBy(asc(productTranslations.name), asc(productVariants.displayOrder))
    .limit(Math.min(Math.max(limit, 1), 500));
}
