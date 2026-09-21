import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  auditLogs,
  inventory,
  inventoryTransactions,
  productTranslations,
  products,
  productVariants,
  stores,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

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


export async function adjustVendorInventory(
  vendorId: string,
  inventoryId: string,
  actorUserId: string,
  delta: number,
  reason: string
) {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new ValidationError('Stock adjustment must be a non-zero whole number.', {
      delta: ['Use a non-zero whole number.'],
    });
  }
  const actionReason = reason.trim();
  if (!actionReason) {
    throw new ValidationError('An adjustment reason is required.', {
      reason: ['Enter a reason.'],
    });
  }

  const db = await getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: inventory.id,
        variantId: inventory.variantId,
        storeId: inventory.storeId,
        quantityAvailable: inventory.quantityAvailable,
        version: inventory.version,
      })
      .from(inventory)
      .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        and(
          eq(inventory.id, inventoryId),
          eq(products.vendorId, vendorId),
          isNull(products.deletedAt),
          isNull(productVariants.deletedAt)
        )
      )
      .limit(1);

    if (!before) throw new NotFoundError('Inventory row could not be found.');

    const quantityAfter = before.quantityAvailable + delta;
    if (quantityAfter < 0) {
      throw new ConflictError('Stock cannot be adjusted below zero.');
    }

    await tx
      .update(inventory)
      .set({
        quantityAvailable: quantityAfter,
        version: before.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(inventory.id, inventoryId));

    await tx.insert(inventoryTransactions).values({
      variantId: before.variantId,
      storeId: before.storeId,
      txnType: 'ADJUSTMENT',
      quantityDelta: delta,
      quantityAfter,
      referenceType: 'MANUAL',
      reason: actionReason,
      createdBy: actorUserId,
    });

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'VENDOR',
      action: 'UPDATE',
      entityType: 'inventory',
      entityId: inventoryId,
      before: { quantityAvailable: before.quantityAvailable, version: before.version },
      after: { quantityAvailable: quantityAfter, version: before.version + 1 },
      changedFields: ['quantityAvailable', 'version'],
      reason: actionReason,
    });

    return { id: inventoryId, quantityAvailable: quantityAfter };
  });
}
