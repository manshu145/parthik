import { z } from 'zod';
import { PAYMENT_METHODS } from './checkout.types';

/**
 * Checkout input contracts (docs/API_SPEC.md §6).
 *
 * The body carries CHOICES only — which address, which payment method. No amount, no fee,
 * no total. Every figure is recomputed server-side, so there is nothing here a client
 * could send that would change what the order costs.
 */
export const quoteBodySchema = z.object({
  /** Omitted means "use my default address". */
  addressId: z.string().uuid('That address could not be found.').optional().nullable(),

  /**
   * Omitted is valid and common: the first quote is requested before the customer has
   * chosen how to pay, so the response can tell them which methods are even available.
   */
  paymentMethod: z
    .enum(PAYMENT_METHODS as unknown as [string, ...string[]])
    .optional()
    .nullable(),
});

export type QuoteBody = z.infer<typeof quoteBodySchema>;
