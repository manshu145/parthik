import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { drivers, inventory, orders, products, vendors } from '@/db/schema';
import { getDb } from '@/lib/db/client';

export interface AdminDashboardSnapshot {
  totalOrders: number;
  openOrders: number;
  deliveredOrders: number;
  grossDeliveredPaise: number;
  approvedVendors: number;
  pendingVendors: number;
  approvedDrivers: number;
  onlineDrivers: number;
  activeProducts: number;
  lowStockItems: number;
}

function countExpr() {
  return sql<number>`count(*)::int`;
}

/**
 * Compact operational snapshot for the admin landing page.
 *
 * This deliberately avoids settlement/tax-derived KPIs while D-14/D-15 remain blocked.
 * Every number here comes from an already-approved operational state transition.
 */
export async function readAdminDashboard(): Promise<AdminDashboardSnapshot> {
  const db = await getDb();

  const [
    [totalOrders],
    [openOrders],
    [deliveredOrders],
    [deliveredGross],
    [approvedVendors],
    [pendingVendors],
    [approvedDrivers],
    [onlineDrivers],
    [activeProducts],
    [lowStockItems],
  ] = await Promise.all([
    db.select({ count: countExpr() }).from(orders),
    db
      .select({ count: countExpr() })
      .from(orders)
      .where(sql`${orders.status} not in ('DELIVERED', 'CANCELLED', 'FAILED')`),
    db.select({ count: countExpr() }).from(orders).where(eq(orders.status, 'DELIVERED')),
    db
      .select({ total: sql<number>`coalesce(sum(${orders.totalAmountPaise}), 0)::int` })
      .from(orders)
      .where(eq(orders.status, 'DELIVERED')),
    db
      .select({ count: countExpr() })
      .from(vendors)
      .where(and(eq(vendors.status, 'APPROVED'), isNull(vendors.deletedAt))),
    db
      .select({ count: countExpr() })
      .from(vendors)
      .where(and(sql`${vendors.status} in ('APPLIED', 'UNDER_REVIEW')`, isNull(vendors.deletedAt))),
    db
      .select({ count: countExpr() })
      .from(drivers)
      .where(and(eq(drivers.status, 'APPROVED'), isNull(drivers.deletedAt))),
    db
      .select({ count: countExpr() })
      .from(drivers)
      .where(
        and(
          eq(drivers.status, 'APPROVED'),
          eq(drivers.availability, 'ONLINE'),
          isNull(drivers.deletedAt)
        )
      ),
    db
      .select({ count: countExpr() })
      .from(products)
      .where(and(eq(products.status, 'ACTIVE'), isNull(products.deletedAt))),
    db
      .select({ count: countExpr() })
      .from(inventory)
      .where(
        and(
          eq(inventory.trackInventory, true),
          lte(inventory.quantityAvailable, inventory.lowStockThreshold)
        )
      ),
  ]);

  return {
    totalOrders: totalOrders?.count ?? 0,
    openOrders: openOrders?.count ?? 0,
    deliveredOrders: deliveredOrders?.count ?? 0,
    grossDeliveredPaise: deliveredGross?.total ?? 0,
    approvedVendors: approvedVendors?.count ?? 0,
    pendingVendors: pendingVendors?.count ?? 0,
    approvedDrivers: approvedDrivers?.count ?? 0,
    onlineDrivers: onlineDrivers?.count ?? 0,
    activeProducts: activeProducts?.count ?? 0,
    lowStockItems: lowStockItems?.count ?? 0,
  };
}
