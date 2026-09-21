import { desc, eq } from 'drizzle-orm';
import { auditLogs, orders, stores, vendors } from '@/db/schema';
import { getDb } from '@/lib/db/client';

export interface AdminOrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  isCod: boolean;
  totalAmountPaise: number;
  vendorName: string;
  storeName: string;
  createdAt: Date;
}

/**
 * Operations list for authorised admins.
 * Customer phone/address are intentionally absent; those are only loaded on the detail route.
 */
export async function listAdminOrders(limit = 100): Promise<AdminOrderListItem[]> {
  const db = await getDb();

  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      paymentMethod: orders.paymentMethod,
      isCod: orders.isCod,
      totalAmountPaise: orders.totalAmountPaise,
      vendorName: vendors.businessName,
      storeName: stores.name,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .innerJoin(vendors, eq(vendors.id, orders.vendorId))
    .innerJoin(stores, eq(stores.id, orders.storeId))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(Math.min(Math.max(limit, 1), 200));
}


export async function updateAdminOrderNote(
  orderId: string,
  note: string | null,
  actorUserId: string
): Promise<void> {
  const db = await getDb();

  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ id: orders.id, internalNote: orders.internalNote })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!before) throw new Error('Order not found.');

    await tx
      .update(orders)
      .set({ internalNote: note, updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entityType: 'order',
      entityId: orderId,
      before: { internalNote: before.internalNote ? '[present]' : null },
      after: { internalNote: note ? '[present]' : null },
      changedFields: ['internalNote'],
      reason: 'Admin internal order note updated',
    });
  });
}
