import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { deliveries, drivers, orders } from '@/db/schema';
import type { Database } from '@/lib/db/client';
import { decodeCursor, encodeCursor } from '@/lib/db/cursor';
import { NotFoundError } from '@/lib/errors';

const CURSOR_KEY = 'createdAt';

export interface DriverHistoryItem {
  delivery: {
    id: string;
    status: string;
    codExpectedPaise: number | null;
    failedAt: Date | null;
    failureReason: string | null;
    deliveredAt: Date | null;
    createdAt: Date;
  };
  order: {
    orderNumber: string;
    status: string;
    isCod: boolean;
    codAmountPaise: number | null;
    totalAmountPaise: number;
  };
}

export interface DriverHistoryPage {
  items: DriverHistoryItem[];
  nextCursor: string | null;
}

export class DriverHistoryRepository {
  constructor(private readonly db: Database) {}

  async listForUser(
    userId: string,
    page: { limit: number; cursor?: string | undefined }
  ): Promise<DriverHistoryPage> {
    const [driver] = await this.db
      .select({ id: drivers.id })
      .from(drivers)
      .where(and(eq(drivers.userId, userId), isNull(drivers.deletedAt)))
      .limit(1);

    if (!driver) throw new NotFoundError('No driver profile is linked to this account.');

    const decoded = page.cursor ? decodeCursor(page.cursor, CURSOR_KEY) : null;
    const cursorDate = decoded ? new Date(decoded.value) : null;
    const validCursorDate = cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate : null;
    const limit = Math.min(Math.max(page.limit, 1), 100);

    const cursorPredicate =
      decoded && validCursorDate
        ? or(
            lt(deliveries.createdAt, validCursorDate),
            and(eq(deliveries.createdAt, validCursorDate), lt(deliveries.id, decoded.id))
          )
        : undefined;

    const rows = await this.db
      .select({
        delivery: {
          id: deliveries.id,
          status: deliveries.status,
          codExpectedPaise: deliveries.codExpectedPaise,
          failedAt: deliveries.failedAt,
          failureReason: deliveries.failureReason,
          deliveredAt: deliveries.deliveredAt,
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
        cursorPredicate
          ? and(eq(deliveries.driverId, driver.id), cursorPredicate)
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
}
