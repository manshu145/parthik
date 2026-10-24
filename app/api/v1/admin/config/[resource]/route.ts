import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import {
  createAdminBrand,
  createAdminCategory,
  createAdminDeliveryZone,
} from '@/modules/admin-configuration';

const slug = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const nullableUuid = z.string().uuid().nullable();
const nullableInt = z.number().int().min(0).nullable();

const categorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug,
  description: z.string().trim().max(2000).nullable(),
  parentId: nullableUuid,
  displayOrder: z.number().int().min(0).max(32767),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
});

const brandSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug,
  logoKey: z.string().trim().max(500).nullable(),
  isActive: z.boolean(),
});

const zoneSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().min(2).max(120),
  isActive: z.boolean(),
  radiusKm: z.number().int().min(1).max(500).nullable(),
  baseDeliveryFeePaise: z.number().int().min(0).max(10_000_000),
  freeDeliveryThresholdPaise: nullableInt,
  minOrderPaise: z.number().int().min(0).max(10_000_000),
  perKmFeePaise: nullableInt,
  maxDeliveryFeePaise: nullableInt,
  avgDeliveryMinutes: z.number().int().min(1).max(1440).nullable(),
  pincodes: z.array(z.string().regex(/^\d{6}$/)).max(5000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ resource: string }> }
) {
  const requestId = requestIdFrom(request);
  try {
    const { resource } = await params;
    const actor = await requireCurrentPermission(permissionFor(resource));
    const body = await request.json().catch(() => null);

    if (resource === 'category') {
      const parsed = categorySchema.safeParse(body);
      if (!parsed.success)
        throw new ValidationError('Check the category fields.', parsed.error.flatten().fieldErrors);
      return apiSuccess(await createAdminCategory(parsed.data, actor.userId), {
        status: 201,
        meta: { requestId },
      });
    }
    if (resource === 'brand') {
      const parsed = brandSchema.safeParse(body);
      if (!parsed.success)
        throw new ValidationError('Check the brand fields.', parsed.error.flatten().fieldErrors);
      return apiSuccess(await createAdminBrand(parsed.data, actor.userId), {
        status: 201,
        meta: { requestId },
      });
    }
    if (resource === 'zone') {
      const parsed = zoneSchema.safeParse(body);
      if (!parsed.success)
        throw new ValidationError(
          'Check the delivery zone fields.',
          parsed.error.flatten().fieldErrors
        );
      return apiSuccess(await createAdminDeliveryZone(parsed.data, actor.userId), {
        status: 201,
        meta: { requestId },
      });
    }

    throw new ValidationError('Unsupported admin configuration resource.');
  } catch (error) {
    return apiError(error, { requestId });
  }
}

function permissionFor(resource: string) {
  if (resource === 'category') return 'category:manage' as const;
  if (resource === 'brand') return 'brand:manage' as const;
  if (resource === 'zone') return 'zone:manage' as const;
  throw new ValidationError('Unsupported admin configuration resource.');
}
