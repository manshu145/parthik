import { desc, eq } from 'drizzle-orm';
import { deliveries, drivers, orders, stores, vendors } from '@/db/schema';
import { getDb } from '@/lib/db/client';

export async function listAdminDeliveries(limit = 250) {
  const db = await getDb();

  return db
    .select({
      id: deliveries.id,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      status: deliveries.status,
      storeName: stores.name,
      vendorName: vendors.businessName,
      driverId: drivers.id,
      driverName: drivers.fullName,
      driverCode: drivers.driverCode,
      distanceKm: deliveries.distanceKm,
      deliveryFeePaise: deliveries.deliveryFeePaise,
      codExpectedPaise: deliveries.codExpectedPaise,
      codCollectedPaise: deliveries.codCollectedPaise,
      codVariancePaise: deliveries.codVariancePaise,
      assignedAt: deliveries.assignedAt,
      pickedUpAt: deliveries.pickedUpAt,
      deliveredAt: deliveries.deliveredAt,
      failedAt: deliveries.failedAt,
      failureReason: deliveries.failureReason,
      createdAt: deliveries.createdAt,
    })
    .from(deliveries)
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .innerJoin(stores, eq(stores.id, deliveries.storeId))
    .innerJoin(vendors, eq(vendors.id, orders.vendorId))
    .leftJoin(drivers, eq(drivers.id, deliveries.driverId))
    .orderBy(desc(deliveries.createdAt), desc(deliveries.id))
    .limit(Math.min(Math.max(limit, 1), 500));
}
