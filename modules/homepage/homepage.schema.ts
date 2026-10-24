import { z } from 'zod';

export const homeSectionSchema = z.object({
  type: z.enum(['HERO_BANNERS', 'FEATURED_CATEGORIES', 'POPULAR_PRODUCTS', 'COUPON_STRIP']),
  title: z.string().trim().max(160).nullable(),
  visible: z.boolean(),
  config: z.object({
    limit: z.number().int().min(1).max(24).optional(),
    placement: z.enum(['HOME_HERO', 'HOME_STRIP', 'CATEGORY', 'OFFERS']).optional(),
  }),
});
