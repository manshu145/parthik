/**
 * Money handling (docs/ARCHITECTURE.md §2 principle 6).
 *
 * All monetary values are integer PAISE. Floats are never used for currency,
 * and formatting happens only at the presentation edge.
 *
 * The branded type makes it a type error to pass a raw number where paise is
 * expected, which is what stops a rupee value silently being treated as paise —
 * a 100x bug that is very hard to spot in review.
 */

export type Paise = number & { readonly __brand: 'Paise' };

export const CURRENCY = 'INR' as const;

export function paise(value: number): Paise {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Paise must be an integer, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Paise value out of safe integer range: ${value}`);
  }
  return value as Paise;
}

/** Converts rupees to paise, rounding half-up at the paise boundary. */
export function rupeesToPaise(rupees: number): Paise {
  return paise(Math.round(rupees * 100));
}

export function paiseToRupees(value: Paise): number {
  return value / 100;
}

export function addPaise(...values: Paise[]): Paise {
  return paise(values.reduce<number>((total, value) => total + value, 0));
}

export function subtractPaise(a: Paise, b: Paise): Paise {
  return paise(a - b);
}

export function multiplyPaise(value: Paise, quantity: number): Paise {
  if (!Number.isInteger(quantity)) {
    throw new TypeError(`Quantity must be an integer, received ${quantity}`);
  }
  return paise(value * quantity);
}

/**
 * Applies a percentage, rounding half-up. Used for discounts and (later) tax.
 * Rounding direction is fixed here on purpose so every money calculation in the
 * system rounds identically — inconsistent rounding is how totals stop
 * reconciling with payments.
 */
export function percentageOfPaise(value: Paise, percent: number): Paise {
  return paise(Math.round((value * percent) / 100));
}

export function clampPaise(value: Paise, min: Paise, max: Paise): Paise {
  return paise(Math.min(Math.max(value, min), max));
}

export function isZero(value: Paise): boolean {
  return value === 0;
}

export const ZERO_PAISE = paise(0);

/**
 * Formats paise for display in the Indian locale, e.g. 45900 -> "₹459".
 * Fractional paise are only shown when non-zero, matching how prices are
 * normally written in this market.
 */
export function formatPaise(value: Paise, locale: 'en' | 'hi' = 'en'): string {
  const rupees = paiseToRupees(value);
  const hasFraction = value % 100 !== 0;

  return new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(rupees);
}
