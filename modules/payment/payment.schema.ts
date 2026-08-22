import { z } from 'zod';

/**
 * Payment input contracts (docs/API_SPEC.md §6).
 *
 * NOTHING MONETARY IS ACCEPTED FROM A CLIENT. There is no amount field anywhere in this file:
 * the amount always comes from the order row. A body that could carry an amount is a body that
 * could carry the wrong one, and the shape is what makes that impossible rather than a check
 * somebody has to remember (docs/SECURITY.md §8.1 rule 1).
 */

export const paymentIntentBodySchema = z.object({
  orderId: z.string().uuid('That order could not be found.'),
});

export const paymentIdParamSchema = z.object({
  paymentId: z.string().uuid('That payment could not be found.'),
});

export const paymentStatusQuerySchema = z.object({
  /**
   * The gateway's payment id, as the browser received it.
   *
   * A HINT, never evidence. The server fetches that payment from the provider and checks it
   * belongs to this order and carries the right amount before anything is marked paid — so a
   * customer pasting somebody else's captured payment id gets a refusal, not a confirmed
   * order. Without the hint we can still only wait for the webhook, which is why accepting it
   * is worth the verification cost.
   */
  providerPaymentId: z
    .string()
    .trim()
    .min(4)
    .max(64)
    .regex(/^[A-Za-z0-9_]+$/, 'That payment reference is not valid.')
    .optional(),
});

export const webhookProviderParamSchema = z.object({
  /** Restricted to the providers that exist, so the path cannot be used to probe. */
  provider: z.enum(['razorpay', 'mock']),
});

export const refundBodySchema = z.object({
  /**
   * Explicit and required, because a "refund everything" default is how a partial refund
   * becomes a full one on a mis-click.
   */
  amountPaise: z
    .number()
    .int('A refund must be a whole number of paise.')
    .positive('A refund must be more than zero.'),
  reason: z.string().trim().min(3, 'A reason is required for a refund.').max(300),
});

export type PaymentIntentBody = z.infer<typeof paymentIntentBodySchema>;
export type RefundBody = z.infer<typeof refundBodySchema>;
