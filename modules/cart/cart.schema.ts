import { z } from 'zod';
import { MAX_QUANTITY_PER_LINE } from './cart.types';

/**
 * Cart input validation.
 *
 * `.strict()` everywhere. Note what is deliberately ABSENT: there is no price,
 * name or total in any request shape. A client that could send a price could send
 * the wrong one, so the schema makes that structurally impossible rather than
 * relying on the service to ignore it.
 */

export const variantIdSchema = z.string().uuid('Expected a product variant.');

export const quantitySchema = z.coerce
  .number()
  .int('Quantity must be a whole number.')
  .min(1, 'Quantity must be at least 1.')
  .max(MAX_QUANTITY_PER_LINE, `You can order at most ${MAX_QUANTITY_PER_LINE} of one item.`);

export const addItemSchema = z
  .object({
    variantId: variantIdSchema,
    quantity: quantitySchema.default(1),
  })
  .strict();

export const setQuantitySchema = z
  .object({
    // Zero is allowed here and means "remove", which is what a quantity stepper
    // does when it reaches zero.
    quantity: z.coerce
      .number()
      .int('Quantity must be a whole number.')
      .min(0)
      .max(MAX_QUANTITY_PER_LINE, `You can order at most ${MAX_QUANTITY_PER_LINE} of one item.`),
  })
  .strict();

export const variantIdParamSchema = z.object({ variantId: variantIdSchema }).strict();

export type AddItemInput = z.infer<typeof addItemSchema>;
export type SetQuantityInput = z.infer<typeof setQuantitySchema>;
