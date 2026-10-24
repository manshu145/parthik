import { z } from 'zod';
import { locales } from '@/i18n/routing';
import { MAX_PAGE_SIZE } from '@/lib/db/repository';
import { PRODUCT_SORT_KEYS } from './catalog.repository.types';

/**
 * Catalog input validation.
 *
 * `.strict()` everywhere: an unknown field is a 422, never silently dropped. A
 * typo'd filter that is quietly ignored returns a full, wrong result set, which
 * looks like working software.
 */

/**
 * URL slug.
 *
 * Bounded and character-restricted because slugs are interpolated into cache keys
 * and canonical URLs. Uppercase is rejected rather than normalised, so one piece
 * of content cannot be reached by two different cache keys.
 */
export const slugSchema = z
  .string()
  .trim()
  .min(1, 'A slug is required.')
  .max(140, 'That slug is too long.')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slugs use lowercase letters, numbers and hyphens.');

export const uuidSchema = z.string().uuid('Expected an id.');

export const localeSchema = z.enum(locales);

/** Sort is an allowlisted key plus optional direction — never a raw column name. */
export const productSortSchema = z.string().refine(
  (value) => {
    const [key, direction] = value.split(':');
    if (!key || !PRODUCT_SORT_KEYS.includes(key as (typeof PRODUCT_SORT_KEYS)[number])) {
      return false;
    }
    return direction === undefined || direction === 'asc' || direction === 'desc';
  },
  `Sort must be one of ${PRODUCT_SORT_KEYS.join(', ')}, optionally with :asc or :desc.`
);

/**
 * Money filters carry the `Paise` suffix.
 *
 * docs/API_SPEC.md §5 lists these as `minPrice`/`maxPrice`, but §1.2 requires every
 * monetary field to be integer paise with an explicit `…Paise` suffix. The suffix
 * wins: an unsuffixed price parameter is ambiguous between rupees and paise, and
 * that ambiguity is precisely how a 100× pricing error reaches a customer.
 */
const paiseFilterSchema = z.coerce
  .number()
  .int('Prices are integer paise.')
  .min(0, 'Prices cannot be negative.')
  .max(100_000_000, 'That price is out of range.');

export const productListQuerySchema = z
  .object({
    /** Category SLUG, not id — ids are internal and must not appear in URLs. */
    category: slugSchema.optional(),
    brand: slugSchema.optional(),
    minPricePaise: paiseFilterSchema.optional(),
    maxPricePaise: paiseFilterSchema.optional(),
    inStock: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    search: z.string().trim().min(2, 'Search for at least 2 characters.').max(120).optional(),
    sort: productSortSchema.optional(),
    cursor: z.string().min(1).max(400).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.minPricePaise === undefined ||
      value.maxPricePaise === undefined ||
      value.minPricePaise <= value.maxPricePaise,
    {
      message: 'The minimum price cannot exceed the maximum price.',
      path: ['minPricePaise'],
    }
  );

export const categorySlugParamSchema = z.object({ slug: slugSchema }).strict();

export const productSlugParamSchema = z.object({ slug: slugSchema }).strict();

export const productIdParamSchema = z.object({ id: uuidSchema }).strict();

export const relatedProductsQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(24).optional() })
  .strict();

export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type RelatedProductsQuery = z.infer<typeof relatedProductsQuerySchema>;
