import { z } from 'zod';
import { locales } from '@/i18n/routing';

/**
 * Identity input contracts (docs/API_SPEC.md §2).
 *
 * Validated at the boundary before anything else runs. Note what is NOT accepted
 * here: no phone number, no uid, no role. Identity comes exclusively from the
 * verified Firebase token, because anything in a request body is attacker-controlled
 * — accepting a `phone` field alongside the token would be an account-takeover
 * primitive.
 */

/** ID tokens are long; the ceiling stops a multi-megabyte body reaching the verifier. */
const MAX_ID_TOKEN_LENGTH = 4096;

export const createSessionSchema = z.object({
  idToken: z
    .string()
    .trim()
    .min(1, 'An ID token is required.')
    .max(MAX_ID_TOKEN_LENGTH, 'The supplied token is not a valid ID token.'),

  /**
   * Locale preference, applied only when creating a NEW user. An existing user's
   * stored preference is not overwritten by a sign-in from a different device.
   */
  locale: z.enum(locales).optional(),
});

export type CreateSessionInputDto = z.infer<typeof createSessionSchema>;

export const revokeSessionSchema = z.object({
  /** When true, every session for the user is revoked ("log out everywhere"). */
  allDevices: z.boolean().default(false),
});

export type RevokeSessionInputDto = z.infer<typeof revokeSessionSchema>;

/** The safe projection of the signed-in user. Never includes tokens or hashes. */
export const sessionUserSchema = z.object({
  id: z.string(),
  phone: z.string().nullable(),
  fullName: z.string().nullable(),
  preferredLocale: z.enum(locales),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  landingPath: z.string(),
});

export type SessionUserDto = z.infer<typeof sessionUserSchema>;
