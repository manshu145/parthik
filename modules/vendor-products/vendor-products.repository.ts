import { and, desc, eq, isNull } from 'drizzle-orm';
import { productTranslations, products, stores } from '@/db/schema';
import { getDb } from '@/lib/db/client';

export interface VendorProductListItem {
  id: string;
  name: string;
  slug: string;
  status: (typeof products.$inferSelect)['status'];
  storeName: string;
  pricePaise: number;
  mrpPaise: number;
  soldCount: number;
  ratingAvg: string | null;
  updatedAt: Date;
}

/** Vendor-owned product list. Tenant isolation lives in this repository boundary. */
export async function listVendorProducts(
  vendorId: string,
  limit = 200
): Promise<VendorProductListItem[]> {
  const db = await getDb();

  return db
    .select({
      id: products.id,
      name: productTranslations.name,
      slug: products.slug,
      status: products.status,
      storeName: stores.name,
      pricePaise: products.pricePaise,
      mrpPaise: products.mrpPaise,
      soldCount: products.soldCount,
      ratingAvg: products.ratingAvg,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .innerJoin(stores, eq(stores.id, products.storeId))
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, 'en'))
    )
    .where(
      and(eq(products.vendorId, vendorId), isNull(products.deletedAt), isNull(stores.deletedAt))
    )
    .orderBy(desc(products.updatedAt), desc(products.id))
    .limit(Math.min(Math.max(limit, 1), 500));
}
