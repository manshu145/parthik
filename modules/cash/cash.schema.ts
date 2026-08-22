import { z } from 'zod';

/**
 * Cash custody input contracts (docs/API_SPEC.md §6.2).
 *
 * Every amount here is in PAISE and must be a whole number. A rupee-denominated float would let
 * `12.345` through, and a third of a paisa in a cash ledger is a reconciliation that never
 * balances.
 */

const paiseAmount = z
  .number()
  .int('Amounts must be a whole number of paise.')
  .max(100_000_000, 'That amount is implausibly large.');

export const declareDepositBodySchema = z.object({
  declaredAmountPaise: paiseAmount.positive('Enter the amount you are depositing.'),
  method: z.enum(['BANK_TRANSFER', 'OFFICE_CASH', 'UPI']),
  /** The bank reference or slip number. Doubles as the idempotency key when supplied. */
  reference: z.string().trim().min(3).max(80).optional().nullable(),
  proofKey: z.string().trim().max(300).optional().nullable(),
  idempotencyKey: z
    .string()
    .trim()
    .min(8, 'An idempotency key is required.')
    .max(128)
    .regex(/^[A-Za-z0-9_:-]+$/, 'The idempotency key contains unsupported characters.'),
});

export const depositIdParamSchema = z.object({
  depositId: z.string().uuid('That deposit could not be found.'),
});

export const verifyDepositBodySchema = z.object({
  /**
   * What was ACTUALLY counted, and it may legitimately be zero — an envelope can turn up empty,
   * and recording that is the whole purpose of the two-step.
   */
  verifiedAmountPaise: paiseAmount.min(0, 'A verified amount cannot be negative.'),
  notes: z.string().trim().max(300).optional().nullable(),
});

export const rejectDepositBodySchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required.').max(300),
});

export const cashAdjustmentBodySchema = z.object({
  driverId: z.string().uuid('That driver could not be found.'),
  /** Signed: negative writes cash off, positive adds it back. Zero is refused. */
  amountPaise: paiseAmount.refine((value) => value !== 0, 'An adjustment of zero changes nothing.'),
  reason: z.string().trim().min(3, 'A reason is required for a cash adjustment.').max(300),
  isWriteOff: z.boolean().optional(),
});

export type DeclareDepositBody = z.infer<typeof declareDepositBodySchema>;
export type VerifyDepositBody = z.infer<typeof verifyDepositBodySchema>;
export type CashAdjustmentBody = z.infer<typeof cashAdjustmentBodySchema>;
