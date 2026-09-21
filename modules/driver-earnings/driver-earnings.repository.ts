import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { driverEarnings, drivers } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { NotFoundError } from '@/lib/errors';

export interface DriverEarningView {
  id: string;
  deliveryId: string | null;
  earningType: string;
  amountPaise: number;
  description: string | null;
  earnedOn: string;
  payoutBatchId: string | null;
  createdAt: Date;
}

export interface DriverEarningsSummary {
  totalPaise: number;
  entries: DriverEarningView[];
}

export async function readDriverEarningsForUser(
  userId: string,
  limit = 100
): Promise<DriverEarningsSummary> {
  const db = await getDb();

  const [driver] = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(and(eq(drivers.userId, userId), isNull(drivers.deletedAt)))
    .limit(1);

  if (!driver) throw new NotFoundError('No driver profile is linked to this account.');

  const [entries, [aggregate]] = await Promise.all([
    db
      .select({
        id: driverEarnings.id,
        deliveryId: driverEarnings.deliveryId,
        earningType: driverEarnings.earningType,
        amountPaise: driverEarnings.amountPaise,
        description: driverEarnings.description,
        earnedOn: driverEarnings.earnedOn,
        payoutBatchId: driverEarnings.payoutBatchId,
        createdAt: driverEarnings.createdAt,
      })
      .from(driverEarnings)
      .where(eq(driverEarnings.driverId, driver.id))
      .orderBy(
        desc(driverEarnings.earnedOn),
        desc(driverEarnings.createdAt),
        desc(driverEarnings.id)
      )
      .limit(Math.min(Math.max(limit, 1), 200)),
    db
      .select({
        totalPaise: sql<number>`coalesce(sum(${driverEarnings.amountPaise}), 0)::int`,
      })
      .from(driverEarnings)
      .where(eq(driverEarnings.driverId, driver.id)),
  ]);

  return {
    totalPaise: aggregate?.totalPaise ?? 0,
    entries: entries.map((entry) => ({
      ...entry,
      amountPaise: Number(entry.amountPaise),
    })),
  };
}
