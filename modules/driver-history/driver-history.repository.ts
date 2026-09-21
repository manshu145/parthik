import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { deliveries, drivers, orders } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { decodeCursor, encodeCursor } from '@/lib/db/cursor';
import { NotFoundError } from '@/lib/errors';

const CURSOR_KEY = 'driver-history-created-at';

export interface DriverHistoryItem {
  delivery: {
    id: string;
    status: (typeof deliveries.$inferSelect)['status'];
    codExpectedPaise: number | null;
    deliveredAt: Date | null;
    failedAt: Date | null;
    failureReason: string | null;
    createdAt: Date;
  };
  order: {
    orderNumber: string;
    status: (typeof orders.$inferSelect)['status'];
    isCod: boolean;
    codAmountPaise: number | null;
    totalAmountPaise: number;
  };
}

export interface DriverHistoryPage {
  items: DriverHistoryItem[];
  nextCursor: string | null;
}

/**
 * Privacy-safe driver history projection with stable descending keyset pagination.
 *
 * The cursor carries both `createdAt` and `id`. Using only the timestamp can skip rows when two
 * deliveries share the same timestamp at a page boundary. Driver ownership is derived from the
 * authenticated user; no caller-supplied driver id is accepted.
 */
export async function getDriverHistoryForUser(input: {
  userId: string;
  limit?: number;
  cursor?: string;
}): Promise<DriverHistoryPage> {
  const db = await getDb();
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);

  const [driver] = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(and(eq(drivers.userId, input.userId), isNull(drivers.deletedAt)))
    .limit(1);

  if (!driver) throw new NotFoundError('No driver profile is linked to this account.');

  const decoded = input.cursor ? decodeCursor(input.cursor, CURSOR_KEY) : null;
  const cursorDate = decoded ? new Date(decoded.value) : null;
  const validCursor = decoded && cursorDate && !Number.isNaN(cursorDate.getTime());

  const cursorCondition = validCursor
    ? or(
        lt(deliveries.createdAt, cursorDate),
        and(eq(deliveries.createdAt, cursorDate), lt(deliveries.id, decoded.id))
      )
    : undefined;

  const rows = await db
    .select({
      delivery: {
        id: deliveries.id,
        status: deliveries.status,
        codExpectedPaise: deliveries.codExpectedPaise,
        deliveredAt: deliveries.deliveredAt,
        failedAt: deliveries.failedAt,
        failureReason: deliveries.failureReason,
        createdAt: deliveries.createdAt,
      },
      order: {
        orderNumber: orders.orderNumber,
        status: orders.status,
        isCod: orders.isCod,
        codAmountPaise: orders.codAmountPaise,
        totalAmountPaise: orders.totalAmountPaise,
      },
    })
    .from(deliveries)
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .where(
      cursorCondition
        ? and(eq(deliveries.driverId, driver.id), cursorCondition)
        : eq(deliveries.driverId, driver.id)
    )
    .orderBy(desc(deliveries.createdAt), desc(deliveries.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor(CURSOR_KEY, last.delivery.createdAt.toISOString(), last.delivery.id)
        : null,
  };
}
