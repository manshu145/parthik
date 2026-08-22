import { z } from 'zod';

/**
 * Delivery input contracts (docs/API_SPEC.md §8).
 *
 * The driver's app sends actions and evidence, never state. There is no `status` field anywhere:
 * a client that could set the status could mark an order delivered without going near it, which
 * is precisely the threat the OTP exists to stop (T14).
 */

export const deliveryIdParamSchema = z.object({
  deliveryId: z.string().uuid('That delivery could not be found.'),
});

/** Optional on every step: a driver who has denied location can still work. */
const position = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const deliveryStepBodySchema = z
  .object({ position: position.optional() })
  .optional()
  .default({});

export const availabilityBodySchema = z.object({
  availability: z.enum(['OFFLINE', 'ONLINE', 'ON_BREAK']),
});

export const locationPingBodySchema = position;

export const deliverBodySchema = z.object({
  /** Exactly six digits. Anything else is refused before an attempt is counted. */
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit delivery code.'),
  /**
   * REQUIRED for a COD order, checked in the service where the order is known.
   *
   * Not defaulted to the expected amount: recording cash that may never have been handed over
   * would make the driver liable for it.
   */
  codCollectedPaise: z
    .number()
    .int('Enter the cash collected in whole paise.')
    .min(0)
    .max(100_000_000)
    .optional()
    .nullable(),
  recipientName: z.string().trim().max(120).optional().nullable(),
  /** A photo or signature key. An EXCEPTION path, reportable separately (D-20). */
  proofKey: z.string().trim().max(300).optional().nullable(),
});

export const declineBodySchema = z.object({
  reason: z.string().trim().max(200).optional().nullable(),
});

export const failBodySchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required.').max(300),
});

export const assignDriverBodySchema = z.object({
  driverId: z.string().uuid('That driver could not be found.'),
});

export type DeliverBody = z.infer<typeof deliverBodySchema>;
