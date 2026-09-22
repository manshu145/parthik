import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { PromotionRepository, type ActiveFreeDeliveryPromotion } from './promotion.repository';

export class PromotionService {
  constructor(private readonly repository: PromotionRepository | null) {}

  activeFreeDelivery(zoneId: string | null): Promise<ActiveFreeDeliveryPromotion | null> {
    if (!this.repository) return Promise.resolve(null);
    return this.repository.findActiveFreeDelivery(zoneId);
  }
}

export async function getPromotionService(): Promise<PromotionService> {
  if (!isDatabaseConfigured()) return new PromotionService(null);
  return new PromotionService(new PromotionRepository(await getDb()));
}

export { PromotionRepository };
export type { ActiveFreeDeliveryPromotion };
