import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { coupons, couponRestrictions, notifications, orders, payoutBatches, products, stores, vendorUsers, vendors } from '@/db/schema';
import { getDb } from '@/lib/db/client';

export async function readVendorAnalytics(vendorId: string) {
  const db = await getDb();
  const [orderStats, productStats, recentOrders] = await Promise.all([
    db
      .select({
        totalOrders: sql<number>`count(*)::int`,
        deliveredOrders: sql<number>`count(*) filter (where ${orders.status} = 'DELIVERED')::int`,
        activeOrders: sql<number>`count(*) filter (where ${orders.status} in ('CONFIRMED','ACCEPTED','PREPARING','READY_FOR_PICKUP','ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY'))::int`,
        cancelledOrders: sql<number>`count(*) filter (where ${orders.status} in ('CANCELLED','FAILED_DELIVERY','RETURNED'))::int`,
        deliveredGmvPaise: sql<number>`coalesce(sum(${orders.totalAmountPaise}) filter (where ${orders.status} = 'DELIVERED'), 0)::bigint`,
        vendorPayoutPaise: sql<number>`coalesce(sum(${orders.vendorPayoutPaise}) filter (where ${orders.status} = 'DELIVERED'), 0)::bigint`,
      })
      .from(orders)
      .where(eq(orders.vendorId, vendorId))
      .then((rows) => rows[0]),
    db
      .select({
        totalProducts: sql<number>`count(*)::int`,
        activeProducts: sql<number>`count(*) filter (where ${products.status} = 'ACTIVE')::int`,
        pendingProducts: sql<number>`count(*) filter (where ${products.status} = 'PENDING_REVIEW')::int`,
        soldUnits: sql<number>`coalesce(sum(${products.soldCount}), 0)::int`,
      })
      .from(products)
      .where(and(eq(products.vendorId, vendorId), isNull(products.deletedAt)))
      .then((rows) => rows[0]),
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        totalAmountPaise: orders.totalAmountPaise,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.vendorId, vendorId))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(10),
  ]);

  return {
    orders: orderStats ?? {
      totalOrders: 0,
      deliveredOrders: 0,
      activeOrders: 0,
      cancelledOrders: 0,
      deliveredGmvPaise: 0,
      vendorPayoutPaise: 0,
    },
    products: productStats ?? {
      totalProducts: 0,
      activeProducts: 0,
      pendingProducts: 0,
      soldUnits: 0,
    },
    recentOrders,
  };
}

export async function listVendorPayoutBatches(vendorId: string, limit = 100) {
  const db = await getDb();
  return db
    .select({
      id: payoutBatches.id,
      periodStart: payoutBatches.periodStart,
      periodEnd: payoutBatches.periodEnd,
      grossAmountPaise: payoutBatches.grossAmountPaise,
      deductionsPaise: payoutBatches.deductionsPaise,
      netAmountPaise: payoutBatches.netAmountPaise,
      status: payoutBatches.status,
      referenceNumber: payoutBatches.referenceNumber,
      approvedAt: payoutBatches.approvedAt,
      paidAt: payoutBatches.paidAt,
      createdAt: payoutBatches.createdAt,
    })
    .from(payoutBatches)
    .where(and(eq(payoutBatches.payeeType, 'VENDOR'), eq(payoutBatches.payeeId, vendorId)))
    .orderBy(desc(payoutBatches.periodEnd), desc(payoutBatches.createdAt))
    .limit(Math.min(Math.max(limit, 1), 250));
}

export async function readVendorStoreSummary(vendorId: string) {
  const db = await getDb();
  const [vendor, storeRows] = await Promise.all([
    db
      .select({
        id: vendors.id,
        businessName: vendors.businessName,
        legalName: vendors.legalName,
        status: vendors.status,
        contactPhone: vendors.contactPhone,
        contactEmail: vendors.contactEmail,
        commissionRate: vendors.commissionRate,
        createdAt: vendors.createdAt,
      })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), isNull(vendors.deletedAt)))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: stores.id,
        name: stores.name,
        slug: stores.slug,
        status: stores.status,
        description: stores.description,
        city: stores.city,
        state: stores.state,
        pincode: stores.pincode,
        deliveryRadiusKm: stores.deliveryRadiusKm,
        codEnabled: stores.codEnabled,
        minOrderPaise: stores.minOrderPaise,
        avgPrepTimeMinutes: stores.avgPrepTimeMinutes,
        ratingAvg: stores.ratingAvg,
        ratingCount: stores.ratingCount,
        isAcceptingOrders: stores.isAcceptingOrders,
        closedUntil: stores.closedUntil,
      })
      .from(stores)
      .where(and(eq(stores.vendorId, vendorId), isNull(stores.deletedAt)))
      .orderBy(stores.createdAt),
  ]);

  return vendor ? { vendor, stores: storeRows } : null;
}

export async function listVendorCoupons(vendorId: string) {
  const db = await getDb();
  return db.select({ id: coupons.id, code: coupons.code, couponType: coupons.couponType, discountValue: coupons.discountValue, minCartPaise: coupons.minCartPaise, usedCount: coupons.usedCount, usageLimitTotal: coupons.usageLimitTotal, validUntil: coupons.validUntil, isActive: coupons.isActive })
    .from(coupons).leftJoin(couponRestrictions, eq(couponRestrictions.couponId, coupons.id))
    .where(and(isNull(coupons.deletedAt), sql`(${couponRestrictions.id} is null or (${couponRestrictions.restrictionType} = 'VENDOR' and ${couponRestrictions.restrictionId} = ${vendorId}::uuid))`))
    .groupBy(coupons.id).orderBy(desc(coupons.createdAt)).limit(100);
}

export async function listVendorNotifications(vendorId: string) {
  const db = await getDb();
  return db.select({ id: notifications.id, title: notifications.title, body: notifications.body, channel: notifications.channel, status: notifications.status, readAt: notifications.readAt, createdAt: notifications.createdAt })
    .from(notifications).innerJoin(vendorUsers, eq(vendorUsers.userId, notifications.userId))
    .where(and(eq(vendorUsers.vendorId, vendorId), isNull(vendorUsers.removedAt)))
    .orderBy(desc(notifications.createdAt)).limit(100);
}
