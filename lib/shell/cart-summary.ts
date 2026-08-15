import type { CartView } from '@/modules/cart';
import { EMPTY_CART_SUMMARY, type CartSummary } from './types';

/**
 * Maps the priced cart view to the shell's display shape.
 *
 * Kept in `lib/` so the shell never imports a module type directly, and so every
 * number the header and drawer show originates from the pricing engine rather than
 * being recomputed for display.
 */
export function toCartSummary(view: CartView | null): CartSummary {
  if (!view) return EMPTY_CART_SUMMARY;

  return {
    itemCount: view.totals.itemCount,
    subtotalPaise: view.totals.taxableAmountPaise,
    deliveryFeePaise: view.totals.deliveryFeePaise,
    totalAmountPaise: view.totals.totalAmountPaise,
    freeDeliveryGapPaise: view.totals.freeDeliveryGapPaise,
    isDeliveryFree: view.totals.isDeliveryFree,
    isQuoteIncomplete: view.totals.isQuoteIncomplete,
    lines: view.lines.map((line) => ({
      id: line.id,
      productName: line.productName,
      variantLabel: line.variantLabel,
      unitLabel: line.unitLabel,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
      lineTotalPaise: line.lineTotalPaise,
      imageKey: line.imageKey,
    })),
  };
}
