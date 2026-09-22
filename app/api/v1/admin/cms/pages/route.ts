import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { createAdminCmsPage } from '@/modules/admin-cms';
import { MARKETING_SLUGS } from '@/modules/cms';

const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string().trim().min(1).max(500), level: z.union([z.literal(2), z.literal(3)]).optional() }),
  z.object({ type: z.literal('paragraph'), text: z.string().trim().min(1).max(10000) }),
  z.object({ type: z.literal('list'), items: z.array(z.string().trim().min(1).max(2000)).max(100), ordered: z.boolean().optional() }),
]);
const contentSchema = z.array(blockSchema).max(200);
const slugSchema = z.string().refine(
  (value) => (MARKETING_SLUGS as readonly string[]).includes(value),
  'Choose one of the supported public page slugs.'
);
export const cmsPageSchema = z.object({
  slug: slugSchema,
  pageType: z.enum(['LEGAL', 'INFO', 'LANDING']),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  titleEn: z.string().trim().min(1).max(200),
  titleHi: z.string().trim().min(1).max(200).nullable(),
  contentEn: contentSchema,
  contentHi: contentSchema,
  metaTitleEn: z.string().trim().max(200).nullable(),
  metaDescriptionEn: z.string().trim().max(500).nullable(),
  metaTitleHi: z.string().trim().max(200).nullable(),
  metaDescriptionHi: z.string().trim().max(500).nullable(),
  robotsIndex: z.boolean(),
  robotsFollow: z.boolean(),
  includeInSitemap: z.boolean(),
});

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentPermission('cms:manage');
    const parsed = cmsPageSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the CMS page fields.', parsed.error.flatten().fieldErrors);
    }
    return apiSuccess(await createAdminCmsPage(parsed.data, actor.userId), {
      status: 201,
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
