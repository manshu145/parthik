import { z } from 'zod';

/**
 * Location input validation (docs/API_SPEC.md §1.2, §3).
 *
 * Validation runs identically whether the mock or the real Google provider is
 * active — a missing credential never relaxes a rule
 * (.kiro/steering/provider-credentials.md).
 *
 * `.strict()` everywhere: unexpected fields are rejected rather than silently
 * dropped, so a client typo surfaces as a 422 instead of being ignored.
 */

/** Indian PIN codes are exactly six digits and never start with 0. */
export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Must be a valid 6-digit Indian PIN code');

/**
 * Coordinate bounds are constrained to India's bounding box rather than the whole
 * globe. A coordinate in the Atlantic is not a serviceability question, and
 * rejecting it early avoids a pointless billable geocode call.
 */
export const latitudeSchema = z.coerce.number().min(6).max(37.5);
export const longitudeSchema = z.coerce.number().min(68).max(97.5);

export const coordinatesSchema = z
  .object({
    latitude: latitudeSchema,
    longitude: longitudeSchema,
  })
  .strict();

/**
 * Places session token.
 *
 * Required because Google bills autocomplete per SESSION rather than per keystroke
 * when one is supplied. Enforcing it here — including against the mock — keeps the
 * cost control honest in development.
 */
export const sessionTokenSchema = z
  .string()
  .trim()
  .min(8, 'A Places session token is required')
  .max(64)
  .regex(/^[\w-]+$/, 'Session token must be URL-safe');

export const serviceabilityQuerySchema = z
  .object({
    pincode: pincodeSchema,
  })
  .strict();

export const reverseGeocodeQuerySchema = z
  .object({
    lat: latitudeSchema,
    lng: longitudeSchema,
  })
  .strict();

export const autocompleteQuerySchema = z
  .object({
    // Minimum three characters: shorter queries return noise and still cost money.
    q: z.string().trim().min(3, 'Enter at least 3 characters').max(120),
    sessionToken: sessionTokenSchema,
    originLat: latitudeSchema.optional(),
    originLng: longitudeSchema.optional(),
  })
  .strict();

export const placeDetailsQuerySchema = z
  .object({
    placeId: z.string().trim().min(1).max(256),
    sessionToken: sessionTokenSchema,
  })
  .strict();

export const routeEstimateBodySchema = z
  .object({
    origin: coordinatesSchema,
    destination: coordinatesSchema,
  })
  .strict();

/**
 * Persists the customer's chosen delivery zone.
 *
 * Accepts a pincode rather than a zone id: the zone is resolved SERVER-SIDE, so a
 * client cannot assert serviceability for itself by naming a zone directly.
 */
export const selectLocationBodySchema = z
  .object({
    pincode: pincodeSchema,
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type ServiceabilityQuery = z.infer<typeof serviceabilityQuerySchema>;
export type AutocompleteQuery = z.infer<typeof autocompleteQuerySchema>;
export type PlaceDetailsQuery = z.infer<typeof placeDetailsQuerySchema>;
export type RouteEstimateBody = z.infer<typeof routeEstimateBodySchema>;
export type SelectLocationBody = z.infer<typeof selectLocationBodySchema>;
