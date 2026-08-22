import { getCartService } from '@/modules/cart';
import { getCatalogService } from '@/modules/catalog';
import { getCustomerService } from '@/modules/customer';
import { getLocationService } from '@/modules/location';
import { CheckoutService } from './checkout.service';

/**
 * Checkout module composition root.
 *
 * No repository of its own: checkout OWNS no data. It composes cart, catalog, customer and
 * location into a single re-verified answer, and the order it produces is TASK 010's to
 * persist. Giving it tables would have meant a second place where a total could be
 * computed.
 */
export async function getCheckoutService(): Promise<CheckoutService> {
  const [cart, catalog, customer, location] = await Promise.all([
    getCartService(),
    getCatalogService(),
    getCustomerService(),
    getLocationService(),
  ]);

  return new CheckoutService({ cart, catalog, customer, location });
}

export { CheckoutService, createCheckoutService } from './checkout.service';
export type { CheckoutServiceDeps, QuoteInput } from './checkout.service';
export { PAYMENT_METHODS } from './checkout.types';
export type {
  CheckoutBlocker,
  CheckoutQuote,
  PaymentMethod,
  PaymentMethodOption,
  PaymentMethodRejection,
} from './checkout.types';
export { quoteBodySchema } from './checkout.schema';
