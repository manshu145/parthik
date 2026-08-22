import { z } from 'zod';

/**
 * Order input contracts (docs/API_SPEC.md §7).
 *
 * The body carries CHOICES and an idempotency key. No amount, no line, no total — every
 * figure is recomputed from the cart and the catalogue, so there is nothing here a client
 * could send that would change what the order costs.
 */

/**
 * Client-supplied idempotency key.
 *
 * REQUIRED, not optional. If the server generated it there would be nothing to recognise a
 * retry BY — the whole point is that the client sends the same value again after a timeout it
 * could not interpret. Bounded and character-restricted so it cannot be used to smuggle
 * anything into a log line.
 */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, 'An idempotency key is required.')
  .max(128)
  .regex(/^[A-Za-z0-9_:-]+$/, 'The idempotency key contains unsupported characters.');

export const placeOrderBodySchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  /** Omitted means "my default address". */
  addressId: z.string().uuid('That address could not be found.').optional().nullable(),
  paymentMethod: z.enum(['UPI', 'CARD', 'COD']),
  customerNote: z.string().trim().max(300).optional().nullable(),
});

export type PlaceOrderBody = z.infer<typeof placeOrderBodySchema>;

export const orderIdParamSchema = z.object({
  orderId: z.string().uuid('That order could not be found.'),
});

export const cancelOrderBodySchema = z.object({
  /**
   * Required for a customer cancellation.
   *
   * Not bureaucracy: the reason is what makes cancellation rates diagnosable. "Cancellations
   * are up 8%" is unactionable; "up 8%, mostly ordered by mistake" points somewhere.
   */
  reason: z.string().trim().min(3, 'Please tell us why you are cancelling.').max(300),
});

export const orderListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

/** Vendor and admin status changes. Cancellation has its own endpoint and rules. */
export const transitionBodySchema = z.object({
  to: z.enum([
    'ACCEPTED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'ASSIGNED',
    'PICKED_UP',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'FAILED_DELIVERY',
    'RETURNED',
    'REFUNDED',
  ]),
  reason: z.string().trim().max(300).optional().nullable(),
});
