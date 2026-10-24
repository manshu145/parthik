import { ZERO_PAISE, type Paise } from '@/lib/money';

/**
 * Tax strategy (decision D-14 — BLOCKED).
 *
 * D-14 is unresolved: the GST treatment has not been determined by an accountant.
 * The approved posture (docs/ARCHITECTURE.md §11.2.2, §16.5) is that tax is
 * ISOLATED BEHIND THIS INTERFACE with exactly one implementation returning zero,
 * so that resolving D-14 later is a new strategy plus a backfill — not a rewrite of
 * every total in the system.
 *
 * TWO RULES THAT ARE NOT NEGOTIABLE while D-14 is blocked:
 *
 *   1. Tax columns are WRITTEN AS ZERO, not left null. The columns exist so
 *      unblocking is a backfill rather than a migration against live financial data.
 *
 *   2. NO TAX LINE IS RENDERED to a customer. Showing "GST ₹0" would itself assert
 *      a tax treatment — that these goods are zero-rated — which is a claim nobody
 *      has authorised. Absence is the only honest presentation. This deliberately
 *      overrides master spec §12's "Taxes if applicable" (conflict V-3).
 */

export interface TaxLine {
  /** Amount the tax was computed on. */
  taxableAmountPaise: Paise;
  taxAmountPaise: Paise;
  /**
   * Whether a tax line may be shown to a customer.
   *
   * False under `NoTaxStrategy`. The UI must branch on this rather than on
   * `taxAmountPaise === 0`, because a genuinely zero-rated item under a resolved
   * D-14 would still need its line displayed.
   */
  isDisplayable: boolean;
}

export interface TaxStrategy {
  readonly name: string;
  /** @param taxableAmountPaise Gross less all discounts. */
  calculate(taxableAmountPaise: Paise): TaxLine;
}

/**
 * The only implementation until D-14 is resolved.
 *
 * Returns zero and marks the line undisplayable.
 */
export class NoTaxStrategy implements TaxStrategy {
  readonly name = 'none' as const;

  calculate(taxableAmountPaise: Paise): TaxLine {
    return {
      taxableAmountPaise,
      taxAmountPaise: ZERO_PAISE,
      isDisplayable: false,
    };
  }
}

export const NO_TAX_STRATEGY: TaxStrategy = new NoTaxStrategy();
