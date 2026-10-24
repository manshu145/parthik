import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { resetEnvCacheForTests } from '@/lib/config/env';
import { mockMapsProvider } from '@/lib/maps/mock-provider';
import { CartService } from '@/modules/cart/cart.service';
import type { CartIntent } from '@/modules/cart/cart.types';
import { CatalogService } from '@/modules/catalog/catalog.service';
import { InMemoryCatalogRepository } from '@/modules/catalog/catalog-memory.repository';
import { CheckoutService } from '@/modules/checkout/checkout.service';
import type { CheckoutQuote, PaymentMethod } from '@/modules/checkout/checkout.types';
import { CouponService } from '@/modules/coupons/coupon.service';
import { InMemoryCouponRepository } from '@/modules/coupons/coupon-memory.repository';
import { CustomerService } from '@/modules/customer/customer.service';
import {
  InMemoryCustomerRepository,
  resetInMemoryAddressesForTests,
} from '@/modules/customer/customer-memory.repository';
import { LocationService } from '@/modules/location/location.service';
import { InMemoryLocationRepository } from '@/modules/location/location-memory.repository';
import { resetSettingsCacheForTests } from '@/modules/settings';

/**
 * Checkout quote tests.
 *
 * The quote is the last thing a customer sees before paying, so what matters here is that
 * it BLOCKS correctly. A quote that is optimistic — says COD is fine when it is not, or
 * lets an unserviceable address through — surfaces as a failure after payment, which is
 * the most expensive place to discover it.
 */

const USER_ID = 'user-checkout-1';
const SERVICEABLE_PINCODE = '452001';
/** Not in the in-memory zone fixture, so serviceability genuinely fails. */
const UNSERVICEABLE_PINCODE = '110001';

const ADDRESS = {
  addressType: 'HOME' as const,
  recipientName: 'Checkout Tester',
  recipientPhone: '+919876543210',
  line1: '1 Test Street',
  city: 'Indore',
  state: 'Madhya Pradesh',
  pincode: SERVICEABLE_PINCODE,
};

function build() {
  const catalog = new CatalogService({ repository: new InMemoryCatalogRepository() });
  const location = new LocationService({
    repository: new InMemoryLocationRepository(),
    maps: mockMapsProvider,
  });
  const coupons = new CouponService({ repository: new InMemoryCouponRepository() });
  const cart = new CartService({ catalog, location, coupons });

  const addressRepository = new InMemoryCustomerRepository({ isolated: true });
  const customer = new CustomerService({ repository: addressRepository, location });

  return {
    checkout: new CheckoutService({ cart, catalog, customer, location }),
    cart,
    catalog,
    customer,
  };
}

async function variantOf(slug: string): Promise<string> {
  const catalog = new CatalogService({ repository: new InMemoryCatalogRepository() });
  const page = await catalog.getProductPage(slug, 'en');
  return page!.product.variants[0]!.id;
}

/** A cart holding enough value to clear the fixture store's minimum order. */
async function filledCart(cart: CartService): Promise<CartIntent> {
  const variantId = await variantOf('demo-atta-5kg');
  return cart.addItem({ storeId: null, lines: [], couponCode: null }, variantId, 4, {
    locale: 'en',
  });
}

function methodOption(quote: CheckoutQuote, method: PaymentMethod) {
  return quote.paymentMethods.find((option) => option.method === method);
}

function blockerCodes(quote: CheckoutQuote): string[] {
  return quote.blockers.map((blocker) => blocker.code);
}

beforeEach(() => {
  resetInMemoryAddressesForTests();
  resetSettingsCacheForTests();
  resetEnvCacheForTests();
});

afterEach(() => {
  resetInMemoryAddressesForTests();
  resetSettingsCacheForTests();
});

describe('blockers', () => {
  it('blocks an empty cart and demands an address', async () => {
    const { checkout } = build();

    const quote = await checkout.quote({
      intent: { storeId: null, lines: [], couponCode: null },
      locale: 'en',
      userId: USER_ID,
    });

    expect(blockerCodes(quote)).toContain('CART_EMPTY');
    expect(blockerCodes(quote)).toContain('ADDRESS_REQUIRED');
    expect(quote.canPlaceOrder).toBe(false);
  });

  it('blocks when the customer has no address at all', async () => {
    const { checkout, cart } = build();

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    expect(blockerCodes(quote)).toContain('ADDRESS_REQUIRED');
    expect(quote.address).toBeNull();
  });

  it('blocks an unserviceable address', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, { ...ADDRESS, pincode: UNSERVICEABLE_PINCODE });

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    // Master spec §11: serviceability is re-verified at checkout, not trusted from the
    // zone stored when the address was saved.
    expect(blockerCodes(quote)).toContain('NOT_SERVICEABLE');
    expect(quote.isServiceable).toBe(false);
    expect(quote.canPlaceOrder).toBe(false);
  });

  it('does not block a serviceable address', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    expect(blockerCodes(quote)).not.toContain('NOT_SERVICEABLE');
    expect(quote.isServiceable).toBe(true);
    expect(quote.zoneId).toBeTruthy();
  });
});

describe('address selection', () => {
  it('uses the default address when none is named', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, { ...ADDRESS, label: 'First' });
    const second = await customer.createAddress(USER_ID, { ...ADDRESS, label: 'Second' });
    await customer.setDefaultAddress(USER_ID, second.id);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    expect(quote.address?.id).toBe(second.id);
  });

  it('honours an explicitly chosen address', async () => {
    const { checkout, cart, customer } = build();
    const first = await customer.createAddress(USER_ID, { ...ADDRESS, label: 'First' });
    await customer.createAddress(USER_ID, { ...ADDRESS, label: 'Second' });

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
      addressId: first.id,
    });

    expect(quote.address?.id).toBe(first.id);
  });

  it('refuses an address belonging to somebody else', async () => {
    const { checkout, cart, customer } = build();
    const mine = await customer.createAddress(USER_ID, ADDRESS);

    // Scoped in the repository's WHERE clause, so this is a NotFound rather than a
    // permission error — the id must not be confirmed to exist.
    await expect(
      checkout.quote({
        intent: await filledCart(cart),
        locale: 'en',
        userId: 'someone-else',
        addressId: mine.id,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('payment methods', () => {
  it('always offers UPI and Card', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    expect(methodOption(quote, 'UPI')?.isAvailable).toBe(true);
    expect(methodOption(quote, 'CARD')?.isAvailable).toBe(true);
  });

  it('offers exactly the three V1 methods and no reserved ones', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    // D-12: NETBANKING and WALLET exist in the enum but are deliberately not offered.
    expect(quote.paymentMethods.map((option) => option.method)).toEqual(['UPI', 'CARD', 'COD']);
  });

  it('offers COD by default for the fixture store', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    expect(methodOption(quote, 'COD')?.isAvailable).toBe(true);
  });

  it('selects nothing until a method is chosen', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    // "Place order" must not be reachable before the customer has said how they will pay.
    expect(quote.selectedMethod).toBeNull();
    expect(quote.canPlaceOrder).toBe(false);
  });

  it('becomes placeable once a valid method is chosen', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
      paymentMethod: 'UPI',
    });

    expect(quote.selectedMethod).toBe('UPI');
    expect(quote.blockers).toEqual([]);
    expect(quote.canPlaceOrder).toBe(true);
  });

  it('sets the COD amount only for COD', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);
    const intent = await filledCart(cart);

    const cod = await checkout.quote({
      intent,
      locale: 'en',
      userId: USER_ID,
      paymentMethod: 'COD',
    });
    const upi = await checkout.quote({
      intent,
      locale: 'en',
      userId: USER_ID,
      paymentMethod: 'UPI',
    });

    // Null for prepaid, so nothing downstream can mistake a prepaid order for one with
    // cash to collect at the door.
    expect(cod.codAmountPaise).toBe(cod.totalPaise);
    expect(upi.codAmountPaise).toBeNull();
  });
});

describe('totals', () => {
  it('reports a total that matches the priced cart', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    // One engine, one number. The quote never re-adds anything itself.
    expect(quote.totalPaise).toBe(quote.cart.totals.totalAmountPaise);
  });

  it('renders NO tax line while D-14 is blocked', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    // Not even a zero one: displaying "₹0 GST" is itself a claim about tax treatment
    // (docs/ARCHITECTURE.md §11.2.2).
    expect(quote.cart.totals.taxAmountPaise).toBe(0);
    expect(quote.cart.totals.isTaxDisplayable).toBe(false);
    expect(quote).not.toHaveProperty('taxPaise');
  });

  it('quotes a delivery fee for the resolved zone', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    expect(quote.deliveryFeePaise).toBeGreaterThanOrEqual(0);
    expect(typeof quote.isFreeDelivery).toBe('boolean');
  });

  it('provides an ETA window for a serviceable address', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    expect(quote.etaMinMinutes).not.toBeNull();
    expect(quote.etaMaxMinutes).not.toBeNull();
    expect(quote.etaMaxMinutes!).toBeGreaterThanOrEqual(quote.etaMinMinutes!);
  });
});

describe('assertPlaceable', () => {
  it('passes a clean quote', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
      paymentMethod: 'COD',
    });

    expect(() => checkout.assertPlaceable(quote)).not.toThrow();
  });

  it('throws the first blocker as a typed error', async () => {
    const { checkout } = build();

    const quote = await checkout.quote({
      intent: { storeId: null, lines: [], couponCode: null },
      locale: 'en',
      userId: USER_ID,
    });

    try {
      checkout.assertPlaceable(quote);
      throw new Error('expected assertPlaceable to throw');
    } catch (error) {
      // A documented machine-readable code, so the client can react rather than parse
      // a message (docs/API_SPEC.md §5).
      expect(error instanceof AppError ? error.code : null).toBe('CART_EMPTY');
    }
  });

  it('throws when no payment method was chosen', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, ADDRESS);

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
    });

    expect(quote.blockers).toEqual([]);
    // Clean, but still not placeable — the method is a required choice.
    expect(() => checkout.assertPlaceable(quote)).toThrow(/payment method/i);
  });

  it('throws NOT_SERVICEABLE for an unserviceable address', async () => {
    const { checkout, cart, customer } = build();
    await customer.createAddress(USER_ID, { ...ADDRESS, pincode: UNSERVICEABLE_PINCODE });

    const quote = await checkout.quote({
      intent: await filledCart(cart),
      locale: 'en',
      userId: USER_ID,
      paymentMethod: 'UPI',
    });

    try {
      checkout.assertPlaceable(quote);
      throw new Error('expected assertPlaceable to throw');
    } catch (error) {
      expect(error instanceof AppError ? error.code : null).toBe('NOT_SERVICEABLE');
    }
  });
});
