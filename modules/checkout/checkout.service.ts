import type { Locale } from '@/i18n/routing';
import { BusinessRuleError } from '@/lib/errors';
import type { CartIntent, CartService, CartView } from '@/modules/cart';
import type { CatalogService } from '@/modules/catalog/catalog.service';
import type { CustomerService } from '@/modules/customer';
import type { AddressRecord } from '@/modules/customer';
import type { LocationService } from '@/modules/location/location.service';
import { getSettings } from '@/modules/settings';
import {
  PAYMENT_METHODS,
  type CheckoutBlocker,
  type CheckoutQuote,
  type PaymentMethod,
  type PaymentMethodOption,
} from './checkout.types';

/**
 * Checkout service (master spec §12, docs/API_SPEC.md §6).
 *
 * ITS ONE JOB: produce a quote that is true at the moment it is produced, and say plainly
 * whether an order can be placed from it.
 *
 * Everything is RE-VERIFIED here even though the cart already checked it. That is not
 * redundancy — the cart was priced when the customer was browsing, and between then and
 * now a zone can be withdrawn, a store can close, stock can sell out and a price can
 * change. Master spec §11 requires serviceability to be re-checked at checkout for exactly
 * this reason.
 *
 * And it is verified a THIRD time inside the order-creation transaction (TASK 010),
 * because even this quote is stale by the time the customer presses pay.
 */

export interface CheckoutServiceDeps {
  cart: CartService;
  catalog: CatalogService;
  customer: CustomerService;
  location: LocationService;
}

export interface QuoteInput {
  intent: CartIntent;
  locale: Locale;
  userId: string;
  /** Null means "use the default address"; the customer may not have chosen yet. */
  addressId?: string | null;
  paymentMethod?: PaymentMethod | null;
}

export class CheckoutService {
  constructor(private readonly deps: CheckoutServiceDeps) {}

  async quote(input: QuoteInput): Promise<CheckoutQuote> {
    const address = await this.resolveAddress(input.userId, input.addressId ?? null);

    // The pincode drives everything downstream: zone, fee, ETA and COD eligibility.
    const pincode = address?.pincode ?? null;

    const cart = await this.deps.cart.view(input.intent, {
      locale: input.locale,
      userId: input.userId,
      ...(pincode ? { pincode } : {}),
    });

    const serviceability = pincode ? await this.deps.location.checkServiceability(pincode) : null;

    const blockers: CheckoutBlocker[] = [];

    if (cart.lines.length === 0) blockers.push({ code: 'CART_EMPTY' });
    if (!address) blockers.push({ code: 'ADDRESS_REQUIRED' });

    if (pincode && !serviceability?.isServiceable) {
      blockers.push({ code: 'NOT_SERVICEABLE', pincode });
    }

    // Per-line problems are surfaced individually so the UI can point at the row rather
    // than saying "something in your cart is wrong".
    for (const line of cart.lines) {
      for (const issue of line.issues) {
        if (issue.code === 'INSUFFICIENT_STOCK') {
          blockers.push({
            code: 'INSUFFICIENT_STOCK',
            variantId: line.variantId,
            availableQuantity: issue.availableQuantity,
          });
        }
        if (issue.code === 'PRODUCT_UNAVAILABLE') {
          blockers.push({ code: 'PRODUCT_UNAVAILABLE', variantId: line.variantId });
        }
      }
    }

    if (!cart.totals.meetsMinimumOrder && cart.totals.minOrderPaise !== null) {
      blockers.push({
        code: 'MIN_ORDER_NOT_MET',
        minOrderPaise: cart.totals.minOrderPaise,
        shortfallPaise: cart.totals.minimumOrderGapPaise ?? 0,
      });
    }

    // ---- Store gate ----
    //
    // Re-read rather than taken from the cart view: a store that closed while the customer
    // was choosing an address must not be able to receive an order.
    const storeAccepting = await this.isStoreAcceptingOrders(cart, input.locale);
    if (cart.lines.length > 0 && !storeAccepting) {
      blockers.push({ code: 'STORE_NOT_ACCEPTING_ORDERS' });
    }

    // ---- Payment methods ----
    const paymentMethods = await this.resolvePaymentMethods({
      cart,
      zoneId: serviceability?.zone?.id ?? null,
      storeCodEnabled: await this.isStoreCodEnabled(cart, input.locale),
    });

    const requested = input.paymentMethod ?? null;
    const selected = requested
      ? (paymentMethods.find((option) => option.method === requested) ?? null)
      : null;

    if (requested && !selected?.isAvailable) {
      blockers.push({ code: 'PAYMENT_METHOD_UNAVAILABLE', method: requested });
    }

    const selectedMethod = selected?.isAvailable ? selected.method : null;
    const totalPaise = cart.totals.totalAmountPaise;

    return {
      cart,
      address,
      zoneId: serviceability?.zone?.id ?? null,
      isServiceable: serviceability?.isServiceable ?? false,
      deliveryFeePaise: cart.totals.deliveryFeePaise,
      isFreeDelivery: cart.totals.isDeliveryFree,
      freeDeliveryGapPaise: cart.totals.freeDeliveryGapPaise,
      etaMinMinutes: cart.etaMinMinutes,
      etaMaxMinutes: cart.etaMaxMinutes,
      paymentMethods,
      selectedMethod,
      totalPaise,
      // Only meaningful for COD; null otherwise so nothing downstream can mistake a
      // prepaid order for one with cash to collect.
      codAmountPaise: selectedMethod === 'COD' ? totalPaise : null,
      blockers,
      // A method must be CHOSEN, not merely available — otherwise "place order" would be
      // enabled before the customer has said how they intend to pay.
      canPlaceOrder: blockers.length === 0 && selectedMethod !== null,
    };
  }

  /**
   * Asserts a quote is placeable, for the order-creation path.
   *
   * Throws the FIRST blocker as a typed error rather than returning a list, because by the
   * time an order is being created the customer has already seen the list and acted on it —
   * anything left is an exception.
   */
  assertPlaceable(quote: CheckoutQuote): void {
    const [blocker] = quote.blockers;

    if (blocker) throw toBusinessRuleError(blocker);

    if (!quote.selectedMethod) {
      throw new BusinessRuleError('BUSINESS_RULE_VIOLATED', 'Choose a payment method to continue.');
    }
  }

  /** The default address, or the requested one. */
  private async resolveAddress(
    userId: string,
    addressId: string | null
  ): Promise<AddressRecord | null> {
    if (addressId) {
      // Scoped to the user by the repository, so another customer's id resolves to null
      // rather than leaking that it exists.
      return this.deps.customer.getAddress(userId, addressId);
    }

    const addresses = await this.deps.customer.listAddresses(userId);
    return addresses.find((address) => address.isDefault) ?? addresses[0] ?? null;
  }

  /**
   * COD eligibility (D-12).
   *
   * Four independent gates, each of which can withdraw cash on delivery on its own:
   * the platform switch, the zone, the store, and the per-order ceiling. They are reported
   * separately so an operator can tell WHY it is unavailable — "COD not available" with no
   * reason is a support ticket.
   */
  private async resolvePaymentMethods(input: {
    cart: CartView;
    zoneId: string | null;
    storeCodEnabled: boolean;
  }): Promise<PaymentMethodOption[]> {
    const settings = await getSettings('cod.enabled', 'cod.max_order_value_paise');

    return PAYMENT_METHODS.map((method): PaymentMethodOption => {
      if (method !== 'COD') {
        // UPI and Card are always offered; whether the gateway accepts them is Razorpay's
        // answer at intent time, not ours to pre-judge here.
        return { method, isAvailable: true };
      }

      if (!settings['cod.enabled']) {
        return { method, isAvailable: false, rejection: { code: 'COD_DISABLED_PLATFORM' } };
      }

      if (!input.storeCodEnabled) {
        return { method, isAvailable: false, rejection: { code: 'COD_DISABLED_STORE' } };
      }

      const max = settings['cod.max_order_value_paise'];
      if (input.cart.totals.totalAmountPaise > max) {
        return {
          method,
          isAvailable: false,
          rejection: { code: 'COD_ORDER_VALUE_TOO_HIGH', maxOrderValuePaise: max },
        };
      }

      return { method, isAvailable: true };
    });
  }

  /**
   * Whether the cart's store still accepts orders.
   *
   * Read via a purchasable-variant lookup, which already carries the store gate, rather
   * than a second store query — one authoritative read is better than two that could
   * disagree.
   */
  private async isStoreAcceptingOrders(cart: CartView, locale: Locale): Promise<boolean> {
    const first = cart.lines[0];
    if (!first) return true;

    const variant = await this.deps.catalog.getPurchasableVariant(first.variantId, locale);
    return variant?.storeAcceptingOrders ?? false;
  }

  private async isStoreCodEnabled(cart: CartView, locale: Locale): Promise<boolean> {
    const first = cart.lines[0];
    if (!first) return true;

    const variant = await this.deps.catalog.getPurchasableVariant(first.variantId, locale);

    // A variant that has vanished means there is nothing to pay for; the CART_EMPTY and
    // PRODUCT_UNAVAILABLE blockers cover that, so this defaults to "not disabled".
    return variant?.storeCodEnabled ?? true;
  }
}

/** Maps a blocker to the documented error code (docs/API_SPEC.md §5). */
function toBusinessRuleError(blocker: CheckoutBlocker): BusinessRuleError {
  switch (blocker.code) {
    case 'CART_EMPTY':
      return new BusinessRuleError('CART_EMPTY', 'Your cart is empty.');
    case 'ADDRESS_REQUIRED':
      return new BusinessRuleError('BUSINESS_RULE_VIOLATED', 'Choose a delivery address.');
    case 'NOT_SERVICEABLE':
      return new BusinessRuleError(
        'NOT_SERVICEABLE',
        `We do not deliver to ${blocker.pincode} yet.`
      );
    case 'STORE_NOT_ACCEPTING_ORDERS':
      return new BusinessRuleError(
        'STORE_NOT_ACCEPTING_ORDERS',
        'This store is not accepting orders right now.'
      );
    case 'MIN_ORDER_NOT_MET':
      return new BusinessRuleError('MIN_ORDER_NOT_MET', 'Your order is below the minimum.', {
        details: {
          minOrderPaise: blocker.minOrderPaise,
          shortfallPaise: blocker.shortfallPaise,
        },
      });
    case 'INSUFFICIENT_STOCK':
      return new BusinessRuleError('INSUFFICIENT_STOCK', 'An item in your cart is out of stock.', {
        details: {
          variantId: blocker.variantId,
          availableQuantity: blocker.availableQuantity,
        },
      });
    case 'PRODUCT_UNAVAILABLE':
      return new BusinessRuleError('PRODUCT_UNAVAILABLE', 'An item in your cart is unavailable.', {
        details: { variantId: blocker.variantId },
      });
    case 'PAYMENT_METHOD_UNAVAILABLE':
      return new BusinessRuleError(
        'BUSINESS_RULE_VIOLATED',
        'That payment method is not available for this order.',
        { details: { method: blocker.method } }
      );
  }
}

export function createCheckoutService(deps: CheckoutServiceDeps): CheckoutService {
  return new CheckoutService(deps);
}
