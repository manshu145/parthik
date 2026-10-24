import { and, desc, eq, lt, or } from 'drizzle-orm';
import { deliveries, orders } from '@/db/schema';
import type { Database } from '@/lib/db/client';
import { decodeCursor, encodeCursor } from '@/lib/db/cursor';
import type { RepositoryContext } from '@/lib/db/repository';
import { DrizzleDeliveryRepository } from './delivery.repository';
import type { DeliveryWithOrder } from './delivery.repository.types';

const HISTORY_CURSOR_KEY = 'createdAt';

/**
 * Delivery repository with a stable keyset cursor for driver history.
 *
 * The base fulfilment repository owns the transactional delivery/COD paths. This subclass only
 * replaces the read-only history query so those high-risk transaction paths stay untouched.
 * Rows are ordered by `(createdAt DESC, id DESC)` and the opaque cursor carries both values;
 * using only createdAt can skip rows when two deliveries share the same timestamp.
 */
export class StableHistoryDeliveryRepository extends DrizzleDeliveryRepository {
  private readonly historyDb: Database;

  constructor(context: RepositoryContext) {
    super(context);
    this.historyDb = context.db;
  }

  override async listForDriver(
    driverId: string,
    page: { limit: number; cursor?: string | undefined }
  ): Promise<{ items: DeliveryWithOrder[]; nextCursor: string | null }> {
    const decoded = page.cursor ? decodeCursor(page.cursor, HISTORY_CURSOR_KEY) : null;
    const cursorDate = decoded ? new Date(decoded.value) : null;
    const hasValidCursor = Boolean(
      decoded && cursorDate && !Number.isNaN(cursorDate.getTime()) && decoded.id
    );

    const cursorFilter =
      hasValidCursor && decoded && cursorDate
        ? or(
            lt(deliveries.createdAt, cursorDate),
            and(eq(deliveries.createdAt, cursorDate), lt(deliveries.id, decoded.id))
          )
        : undefined;

    const rows = await this.historyDb
      .select({
        delivery: {
          id: deliveries.id,
          orderId: deliveries.orderId,
          storeId: deliveries.storeId,
          driverId: deliveries.driverId,
          status: deliveries.status,
          deliveryZoneId: deliveries.deliveryZoneId,
          pickupAddressSnapshot: deliveries.pickupAddressSnapshot,
          dropAddressSnapshot: deliveries.dropAddressSnapshot,
          deliveryFeePaise: deliveries.deliveryFeePaise,
          otpVerifiedAt: deliveries.otpVerifiedAt,
          otpAttempts: deliveries.otpAttempts,
          otpRegeneratedCount: deliveries.otpRegeneratedCount,
          assignedAt: deliveries.assignedAt,
          pickedUpAt: deliveries.pickedUpAt,
          deliveredAt: deliveries.deliveredAt,
          failedAt: deliveries.failedAt,
          failureReason: deliveries.failureReason,
          codExpectedPaise: deliveries.codExpectedPaise,
          codCollectedPaise: deliveries.codCollectedPaise,
          codVariancePaise: deliveries.codVariancePaise,
          createdAt: deliveries.createdAt,
        },
        order: {
          id: orders.id,
          orderNumber: orders.orderNumber,
          userId: orders.userId,
          status: orders.status,
          isCod: orders.isCod,
          codAmountPaise: orders.codAmountPaise,
          totalAmountPaise: orders.totalAmountPaise,
          contactName: orders.contactName,
          contactPhone: orders.contactPhone,
          vendorId: orders.vendorId,
        },
      })
      .from(deliveries)
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      .where(
        cursorFilter
          ? and(eq(deliveries.driverId, driverId), cursorFilter)
          : eq(deliveries.driverId, driverId)
      )
      .orderBy(desc(deliveries.createdAt), desc(deliveries.id))
      .limit(page.limit + 1);

    const hasMore = rows.length > page.limit;
    const visibleRows = hasMore ? rows.slice(0, page.limit) : rows;
    const items: DeliveryWithOrder[] = visibleRows.map((row) => ({
      delivery: {
        ...row.delivery,
        status: row.delivery.status as DeliveryWithOrder['delivery']['status'],
        pickupAddressSnapshot: (row.delivery.pickupAddressSnapshot ?? {}) as Record<
          string,
          unknown
        >,
        dropAddressSnapshot: (row.delivery.dropAddressSnapshot ?? {}) as Record<string, unknown>,
        deliveryFeePaise: Number(row.delivery.deliveryFeePaise ?? 0),
        otpAttempts: Number(row.delivery.otpAttempts ?? 0),
        otpRegeneratedCount: Number(row.delivery.otpRegeneratedCount ?? 0),
        codExpectedPaise:
          row.delivery.codExpectedPaise === null ? null : Number(row.delivery.codExpectedPaise),
        codCollectedPaise:
          row.delivery.codCollectedPaise === null ? null : Number(row.delivery.codCollectedPaise),
        codVariancePaise:
          row.delivery.codVariancePaise === null ? null : Number(row.delivery.codVariancePaise),
      },
      order: {
        ...row.order,
        status: row.order.status as DeliveryWithOrder['order']['status'],
        codAmountPaise: row.order.codAmountPaise === null ? null : Number(row.order.codAmountPaise),
        totalAmountPaise: Number(row.order.totalAmountPaise),
      },
    }));

    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor(
              HISTORY_CURSOR_KEY,
              last.delivery.createdAt.toISOString(),
              last.delivery.id
            )
          : null,
    };
  }
}
