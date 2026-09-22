import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { createAdminBlogPost } from '@/modules/blog';

const blockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    text: z.string().trim().min(1).max(500),
    level: z.union([z.literal(2), z.literal(3)]).optional(),
  }),
  z.object({
    type: z.literal('paragraph'),
    text: z.string().trim().min(1).max(10000),
  }),
  z.object({
    type: z.literal('list'),
    items: z.array(z.string().trim().min(1).max(2000)).max(100),
    ordered: z.boolean().optional(),
  }),
]);

const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const adminBlogSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a lowercase URL slug.'),
  coverImageKey: nullableText(1000),
  category: nullableText(200),
  tags: z.array(z.string().trim().min(1).max(100)).max(30),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  titleEn: z.string().trim().min(1).max(300),
  excerptEn: nullableText(1000),
  contentEn: z.array(blockSchema).max(300),
  titleHi: z.string().trim().min(1).max(300).nullable(),
  excerptHi: nullableText(1000),
  contentHi: z.array(blockSchema).max(300),
  metaTitleEn: nullableText(300),
  metaDescriptionEn: nullableText(600),
  metaTitleHi: nullableText(300),
  metaDescriptionHi: nullableText(600),
  robotsIndex: z.boolean(),
  robotsFollow: z.boolean(),
  includeInSitemap: z.boolean(),
});

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const actor = await requireCurrentPermission('cms:manage');
    const parsed = adminBlogSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Check the blog fields.', parsed.error.flatten().fieldErrors);
    }

    return apiSuccess(await createAdminBlogPost(parsed.data, actor.userId), {
      status: 201,
      meta: { requestId },
    });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
