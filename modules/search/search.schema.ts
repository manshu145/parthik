import { z } from 'zod';
import { MAX_PAGE_SIZE } from '@/lib/db/repository';
import { slugSchema } from '@/modules/catalog/catalog.schema';
import { MAX_SEARCH_TERM_LENGTH, MIN_SEARCH_TERM_LENGTH, SEARCH_SORT_KEYS } from './search.types';

/**
 * Search input validation.
 *
 * `.strict()`: an unknown parameter is a 422, never silently ignored. A typo'd
 * filter that is quietly dropped returns a full, wrong result set.
 */

/**
 * The query term.
 *
 * Bounded at both ends. A one-character term matches most of the catalogue for no
 * useful purpose, and an unbounded term is a cheap way to make the database do
 * expensive trigram work on every request.
 */
export const searchTermSchema = z
  .string()
  .trim()
  .min(MIN_SEARCH_TERM_LENGTH, `Search for at least ${MIN_SEARCH_TERM_LENGTH} characters.`)
  .max(MAX_SEARCH_TERM_LENGTH, 'That search is too long.');

export const searchSortSchema = z.enum(SEARCH_SORT_KEYS);

const paiseFilterSchema = z.coerce
  .number()
  .int('Prices are integer paise.')
  .min(0, 'Prices cannot be negative.')
  .max(100_000_000, 'That price is out of range.');

export const searchQuerySchema = z
  .object({
    q: searchTermSchema,
    /** Category SLUG, not id — ids are internal and must not appear in URLs. */
    category: slugSchema.optional(),
    minPricePaise: paiseFilterSchema.optional(),
    maxPricePaise: paiseFilterSchema.optional(),
    inStock: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    sort: searchSortSchema.optional(),
    /** Offset pagination: results are ranked, so a keyset cursor has no stable key. */
    page: z.coerce.number().int().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.minPricePaise === undefined ||
      value.maxPricePaise === undefined ||
      value.minPricePaise <= value.maxPricePaise,
    { message: 'The minimum price cannot exceed the maximum price.', path: ['minPricePaise'] }
  );

export const suggestQuerySchema = z
  .object({
    q: searchTermSchema,
    limit: z.coerce.number().int().min(1).max(20).optional(),
  })
  .strict();

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
export type SuggestQueryInput = z.infer<typeof suggestQuerySchema>;
