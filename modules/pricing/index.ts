/**
 * Pricing module (docs/ARCHITECTURE.md §11.2).
 *
 * The single source of every monetary total in the system. Pure and dependency
 * free, so cart, checkout, order creation and admin re-quoting cannot drift apart.
 */

export { calculatePricing, allocateDiscount } from './pricing.engine';
export { NoTaxStrategy, NO_TAX_STRATEGY } from './tax-strategy';
export type { TaxLine, TaxStrategy } from './tax-strategy';
export type {
  AppliedDiscount,
  PricedLine,
  PricingInput,
  PricingLineInput,
  PricingResult,
} from './pricing.types';
