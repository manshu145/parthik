import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  categories,
  categoryTranslations,
  inventory,
  inventoryTransactions,
  productTranslations,
  productVariantTranslations,
  productVariants,
  products,
  stores,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type { VendorProductInput, VendorProductUpdateInput } from './vendor-product-manage.schema';

export async function listVendorProductFormOptions(vendorId: string) {
  const db = await getDb();
  const [storeRows, categoryRows] = await Promise.all([
    db
      .select({ id: stores.id, name: stores.name })
      .from(stores)
      .where(and(eq(stores.vendorId, vendorId), isNull(stores.deletedAt)))
      .orderBy(asc(stores.name)),
    db
      .select({ id: categories.id, name: categoryTranslations.name })
      .from(categories)
      .innerJoin(
        categoryTranslations,
        and(
          eq(categoryTranslations.categoryId, categories.id),
          eq(categoryTranslations.locale, 'en')
        )
      )
      .where(and(eq(categories.isActive, true), isNull(categories.deletedAt)))
      .orderBy(asc(categoryTranslations.name)),
  ]);

  return { stores: storeRows, categories: categoryRows };
}

export async function readVendorProductForEdit(vendorId: string, productId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      id: products.id,
      name: productTranslations.name,
      shortDescription: productTranslations.shortDescription,
      description: productTranslations.description,
      storeId: products.storeId,
      categoryId: products.categoryId,
      unitLabel: products.unitLabel,
      pricePaise: products.pricePaise,
      mrpPaise: products.mrpPaise,
      status: products.status,
      version: products.version,
      variantId: productVariants.id,
      sku: productVariants.sku,
      quantityAvailable: inventory.quantityAvailable,
      lowStockThreshold: inventory.lowStockThreshold,
      trackInventory: inventory.trackInventory,
      allowBackorder: inventory.allowBackorder,
    })
    .from(products)
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, 'en'))
    )
    .leftJoin(
      productVariants,
      and(
        eq(productVariants.productId, products.id),
        eq(productVariants.isDefault, true),
        isNull(productVariants.deletedAt)
      )
    )
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(
      and(eq(products.id, productId), eq(products.vendorId, vendorId), isNull(products.deletedAt))
    )
    .limit(1);

  if (!row) return null;
  if (!row.variantId) {
    throw new ConflictError('This product is missing its required default variant.');
  }

  return {
    ...row,
    quantityAvailable: row.quantityAvailable ?? 0,
    lowStockThreshold: row.lowStockThreshold ?? 0,
    trackInventory: row.trackInventory ?? true,
    allowBackorder: row.allowBackorder ?? false,
  };
}

export async function createVendorProduct(
  vendorId: string,
  actorUserId: string,
  input: VendorProductInput
): Promise<{ id: string; slug: string }> {
  const db = await getDb();

  return db.transaction(async (tx) => {
    await assertStoreOwnedByVendor(tx, vendorId, input.storeId);
    await assertCategoryAvailable(tx, input.categoryId);
    await assertSkuAvailable(tx, vendorId, input.sku ?? null);

    const slug = `${slugify(input.name)}-${crypto.randomUUID().slice(0, 8)}`;
    const [product] = await tx
      .insert(products)
      .values({
        vendorId,
        storeId: input.storeId,
        categoryId: input.categoryId,
        slug,
        status: 'DRAFT',
        unitLabel: input.unitLabel,
        pricePaise: input.pricePaise,
        mrpPaise: input.mrpPaise,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning({ id: products.id, slug: products.slug });

    if (!product) throw new ConflictError('Could not create the product.');

    await tx.insert(productTranslations).values({
      productId: product.id,
      locale: 'en',
      name: input.name,
      shortDescription: input.shortDescription ?? null,
      description: input.description ?? null,
      unitLabel: input.unitLabel,
      updatedBy: actorUserId,
    });

    const [variant] = await tx
      .insert(productVariants)
      .values({
        productId: product.id,
        sku: input.sku ?? null,
        mrpPaise: input.mrpPaise,
        pricePaise: input.pricePaise,
        unitLabel: input.unitLabel,
        isDefault: true,
        displayOrder: 0,
        isActive: true,
      })
      .returning({ id: productVariants.id });

    if (!variant) throw new ConflictError('Could not create the default product variant.');

    await tx.insert(productVariantTranslations).values({
      variantId: variant.id,
      locale: 'en',
      name: input.name,
      variantLabel: input.unitLabel,
      updatedBy: actorUserId,
    });

    await tx.insert(inventory).values({
      variantId: variant.id,
      storeId: input.storeId,
      quantityAvailable: input.quantityAvailable,
      quantityReserved: 0,
      lowStockThreshold: input.lowStockThreshold,
      trackInventory: input.trackInventory,
      allowBackorder: input.allowBackorder,
    });

    if (input.quantityAvailable > 0) {
      await tx.insert(inventoryTransactions).values({
        variantId: variant.id,
        storeId: input.storeId,
        txnType: 'PURCHASE',
        quantityDelta: input.quantityAvailable,
        quantityAfter: input.quantityAvailable,
        referenceType: 'MANUAL',
        reason: 'Initial stock on product creation',
        createdBy: actorUserId,
      });
    }

    return product;
  });
}

export async function updateVendorProduct(
  vendorId: string,
  productId: string,
  actorUserId: string,
  input: VendorProductUpdateInput
): Promise<{ id: string; version: number }> {
  const db = await getDb();

  return db.transaction(async (tx) => {
    await assertStoreOwnedByVendor(tx, vendorId, input.storeId);
    await assertCategoryAvailable(tx, input.categoryId);

    const [existing] = await tx
      .select({ id: products.id, storeId: products.storeId })
      .from(products)
      .where(
        and(eq(products.id, productId), eq(products.vendorId, vendorId), isNull(products.deletedAt))
      )
      .limit(1);
    if (!existing) throw new NotFoundError('Product not found.');
    if (existing.storeId !== input.storeId) {
      throw new ValidationError(
        'A product cannot be moved to another store after creation. Create a new product for that store instead.'
      );
    }

    const [variant] = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.productId, productId),
          eq(productVariants.isDefault, true),
          isNull(productVariants.deletedAt)
        )
      )
      .limit(1);
    if (!variant) throw new ConflictError('This product is missing its required default variant.');

    await assertSkuAvailable(tx, vendorId, input.sku ?? null, variant.id);

    const [updated] = await tx
      .update(products)
      .set({
        categoryId: input.categoryId,
        unitLabel: input.unitLabel,
        pricePaise: input.pricePaise,
        mrpPaise: input.mrpPaise,
        updatedBy: actorUserId,
        updatedAt: new Date(),
        version: sql`${products.version} + 1`,
      })
      .where(
        and(
          eq(products.id, productId),
          eq(products.vendorId, vendorId),
          eq(products.version, input.version),
          isNull(products.deletedAt)
        )
      )
      .returning({ id: products.id, version: products.version });

    if (!updated) {
      throw new ConflictError('This product changed after you opened it. Refresh and try again.');
    }

    await tx
      .update(productTranslations)
      .set({
        name: input.name,
        shortDescription: input.shortDescription ?? null,
        description: input.description ?? null,
        unitLabel: input.unitLabel,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      })
      .where(
        and(eq(productTranslations.productId, productId), eq(productTranslations.locale, 'en'))
      );

    await tx
      .update(productVariants)
      .set({
        sku: input.sku ?? null,
        mrpPaise: input.mrpPaise,
        pricePaise: input.pricePaise,
        unitLabel: input.unitLabel,
        updatedAt: new Date(),
      })
      .where(eq(productVariants.id, variant.id));

    await tx
      .update(productVariantTranslations)
      .set({
        name: input.name,
        variantLabel: input.unitLabel,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productVariantTranslations.variantId, variant.id),
          eq(productVariantTranslations.locale, 'en')
        )
      );

    const [stock] = await tx
      .select({ quantityAvailable: inventory.quantityAvailable })
      .from(inventory)
      .where(eq(inventory.variantId, variant.id))
      .limit(1);

    if (!stock) throw new ConflictError('This product is missing its inventory row.');

    const delta = input.quantityAvailable - stock.quantityAvailable;
    await tx
      .update(inventory)
      .set({
        quantityAvailable: input.quantityAvailable,
        lowStockThreshold: input.lowStockThreshold,
        trackInventory: input.trackInventory,
        allowBackorder: input.allowBackorder,
        version: sql`${inventory.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(inventory.variantId, variant.id));

    if (delta !== 0) {
      await tx.insert(inventoryTransactions).values({
        variantId: variant.id,
        storeId: existing.storeId,
        txnType: 'ADJUSTMENT',
        quantityDelta: delta,
        quantityAfter: input.quantityAvailable,
        referenceType: 'MANUAL',
        reason: 'Vendor product edit stock adjustment',
        createdBy: actorUserId,
      });
    }

    return updated;
  });
}

async function assertStoreOwnedByVendor(
  tx: Awaited<ReturnType<typeof getDb>>,
  vendorId: string,
  storeId: string
) {
  const [row] = await tx
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.id, storeId), eq(stores.vendorId, vendorId), isNull(stores.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('Store not found.');
}

async function assertCategoryAvailable(tx: Awaited<ReturnType<typeof getDb>>, categoryId: string) {
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.isActive, true),
        isNull(categories.deletedAt)
      )
    )
    .limit(1);
  if (!row) throw new ValidationError('Choose an active category.');
}

async function assertSkuAvailable(
  tx: Awaited<ReturnType<typeof getDb>>,
  vendorId: string,
  sku: string | null,
  excludeVariantId?: string
) {
  if (!sku) return;

  const predicates = [
    eq(products.vendorId, vendorId),
    eq(productVariants.sku, sku),
    isNull(products.deletedAt),
    isNull(productVariants.deletedAt),
  ];
  if (excludeVariantId) predicates.push(ne(productVariants.id, excludeVariantId));

  const [duplicate] = await tx
    .select({ id: productVariants.id })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(...predicates))
    .limit(1);

  if (duplicate) {
    throw new ConflictError('That SKU is already used by another product in this vendor account.');
  }
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'product';
}
