import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { createAdminBanner } from '@/modules/admin-marketing';

const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const adminBannerSchema = z
  .object({
    placement: z.enum(['HOME_HERO', 'HOME_STRIP', 'CATEGORY', 'OFFERS']),
    linkUrl: nullableText(1000),
    targetAudience: z.enum(['ALL', 'NEW_USERS', 'RETURNING']),
    deliveryZoneId: z.string().uuid().nullable(),
    priority: z.number().int().min(-32768).max(32767),
    startsAt: z.coerce.date().nullable(),
    endsAt: z.coerce.date().nullable(),
    isActive: z.boolean(),
    titleEn: z.string().trim().min(1).max(200),
    subtitleEn: nullableText(500),
    ctaLabelEn: nullableText(100),
    imageKeyEn: nullableText(1000),
    mobileImageKeyEn: nullableText(1000),
    titleHi: z.string().trim().min(1).max(200).nullable(),
    subtitleHi: nullableText(500),
    ctaLabelHi: nullableText(100),
    imageKeyHi: nullableText(1000),
    mobileImageKeyHi: nullableText(1000),
  })
  .superRefine((value, ctx) => {
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'End time must be after start time.',
      });
    }
    if (value.linkUrl && !isSafeBannerLink(value.linkUrl)) {
      ctx.addIssue({
        code: 'custom',
        path: ['linkUrl'],
        message: 'Use a site-relative path or an https URL.',
      });
    }
  });

function isSafeBannerLink(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('banner:manage');
    const parsed = adminBannerSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the banner fields.', parsed.error.flatten().fieldErrors);
    }

    return apiSuccess(await createAdminBanner(parsed.data, actor.userId), {
      status: 201,
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
