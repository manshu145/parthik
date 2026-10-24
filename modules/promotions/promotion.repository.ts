import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { promotions } from '@/db/schema';
import type { Database } from '@/lib/db/client';

export interface ActiveFreeDeliveryPromotion {
  id: string;
  name: string;
}

export class PromotionRepository {
  constructor(private readonly db: Database) {}

  async findActiveFreeDelivery(
    zoneId: string | null,
    now = new Date()
  ): Promise<ActiveFreeDeliveryPromotion | null> {
    const zoneClause = zoneId
      ? or(isNull(promotions.zoneScope), eq(promotions.zoneScope, zoneId))
      : isNull(promotions.zoneScope);

    const [row] = await this.db
      .select({ id: promotions.id, name: promotions.name })
      .from(promotions)
      .where(
        and(
          eq(promotions.promotionType, 'FREE_DELIVERY'),
          eq(promotions.isActive, true),
          isNull(promotions.deletedAt),
          zoneClause,
          or(isNull(promotions.validFrom), lte(promotions.validFrom, now)),
          or(isNull(promotions.validUntil), gte(promotions.validUntil, now))
        )
      )
      .orderBy(desc(promotions.priority), desc(promotions.updatedAt))
      .limit(1);

    return row ?? null;
  }
}
