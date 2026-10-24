import { z } from 'zod';

/**
 * Address input contracts (docs/API_SPEC.md §4).
 *
 * Note what is NOT accepted: `deliveryZoneId`. The zone is resolved server-side from the
 * pincode, because a client that could name its own zone could name a cheaper one — the
 * zone determines the delivery fee and whether COD is offered at all.
 */

/** Indian PIN codes never start with zero. */
export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code.');

/**
 * E.164 or a bare 10-digit Indian mobile.
 *
 * The recipient is often NOT the account holder — a gift, a parent's house, an office
 * reception — so this is validated independently of the signed-in user's own number
 * rather than defaulted from it.
 */
export const recipientPhoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\+91)?[6-9][0-9]{9}$/, 'Enter a valid 10-digit Indian mobile number.')
  .transform((value) => (value.startsWith('+91') ? value : `+91${value}`));

export const addressBodySchema = z.object({
  label: z.string().trim().max(40).optional().nullable(),
  addressType: z.enum(['HOME', 'WORK', 'OTHER']).default('HOME'),

  recipientName: z.string().trim().min(2, 'Enter the recipient name.').max(80),
  recipientPhone: recipientPhoneSchema,

  line1: z.string().trim().min(4, 'Enter the house or flat and street.').max(180),
  line2: z.string().trim().max(180).optional().nullable(),
  landmark: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: pincodeSchema,

  /**
   * Optional coordinates from the map picker. Bounded to India's envelope so a stray or
   * hostile value cannot place an address in the ocean and skew a distance-based fee.
   */
  latitude: z.number().min(6).max(38).optional().nullable(),
  longitude: z.number().min(68).max(98).optional().nullable(),

  deliveryInstructions: z.string().trim().max(300).optional().nullable(),
  isDefault: z.boolean().optional(),
});

export type AddressBody = z.infer<typeof addressBodySchema>;

export const addressIdParamSchema = z.object({
  addressId: z.string().uuid('That address could not be found.'),
});

/** PATCH bodies may set only the default flag, so the shape is a partial. */
export const setDefaultBodySchema = z.object({
  isDefault: z.literal(true),
});
