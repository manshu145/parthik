import { describe, expect, it } from 'vitest';
import { CatalogService } from '@/modules/catalog/catalog.service';
import { InMemoryCatalogRepository } from '@/modules/catalog/catalog-memory.repository';
import { LocationService } from '@/modules/location/location.service';
import { InMemoryLocationRepository } from '@/modules/location/location-memory.repository';
import { mockMapsProvider } from '@/lib/maps/mock-provider';
import { CartService } from '@/modules/cart/cart.service';
import { MAX_QUANTITY_PER_LINE, type CartIntent } from '@/modules/cart/cart.types';
import { AppError } from '@/lib/errors';

/**
 * Cart service tests.
 *
 * The rules under test are the ones with money or trust attached: D-11 single
 * vendor, stock re-read on every mutation, and the fact that no price ever comes
 * from the caller.
 */

function service() {
  const catalog = new CatalogService({ repository: new InMemoryCatalogRepository() });
  const location = new LocationService({
    repository: new InMemoryLocationRepository(),
    maps: mockMapsProvider,
  });

  return new CartService({ catalog, location });
}

const EMPTY: CartIntent = { storeId: null, lines: [], couponCode: null };
const EN = { locale: 'en' as const };
const SERVICEABLE = { locale: 'en' as const, pincode: '452001' };

/** Resolves a fixture slug to its default variant id. */
async function variantOf(slug: string): Promise<string> {
  const catalog = new CatalogService({ repository: new InMemoryCatalogRepository() });
  const page = await catalog.getProductPage(slug, 'en');
  return page!.product.variants[0]!.id;
}

function codeOf(error: unknown): string {
  return error instanceof AppError ? error.code : 'NOT_AN_APP_ERROR';
}

describe('addItem', () => {
  it('adds a variant and locks the cart to its store', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const next = await service().addItem(EMPTY, variantId, 2, EN);

    expect(next.lines).toEqual([{ variantId, quantity: 2 }]);
    // D-11: the store is recorded on first add.
    expect(next.storeId).not.toBeNull();
  });

  it('defaults to adding one', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const next = await service().addItem(EMPTY, variantId, 1, EN);

    expect(next.lines[0]!.quantity).toBe(1);
  });

  it('INCREMENTS an existing line rather than duplicating it', async () => {
    // cart_items is unique on (cart_id, variant_id), so a second add must be an
    // increment or the insert would violate the index.
    const variantId = await variantOf('demo-atta-5kg');
    const cart = service();

    const first = await cart.addItem(EMPTY, variantId, 2, EN);
    const second = await cart.addItem(first, variantId, 3, EN);

    expect(second.lines).toHaveLength(1);
    expect(second.lines[0]!.quantity).toBe(5);
  });

  it('rejects a variant that does not exist', async () => {
    await expect(
      service().addItem(EMPTY, '00000000-0000-4000-8000-000000000000', 1, EN)
    ).rejects.toThrow(/could not be found/i);
  });

  it('rejects an out-of-stock variant with INSUFFICIENT_STOCK', async () => {
    // Tomatoes have stock 0.
    const variantId = await variantOf('demo-tomatoes-1kg');

    await expect(service().addItem(EMPTY, variantId, 1, EN)).rejects.toSatisfy(
      (error) => codeOf(error) === 'INSUFFICIENT_STOCK'
    );
  });

  it('rejects more than the available stock', async () => {
    // The floor cleaner has stock 15 — below MAX_QUANTITY_PER_LINE, so the stock
    // check is reachable. For a higher-stock item the quantity guardrail fires
    // first, which is the correct precedence: "max 20 per item" is more useful
    // than "only 25 left" when the customer asked for 26.
    const variantId = await variantOf('demo-cleaning-liquid-1l');

    await expect(service().addItem(EMPTY, variantId, 16, EN)).rejects.toSatisfy(
      (error) => codeOf(error) === 'INSUFFICIENT_STOCK'
    );
  });

  it('checks the quantity guardrail BEFORE stock', async () => {
    // Milk has 25 in stock. Asking for 26 exceeds both, and the guardrail is the
    // more actionable message.
    const variantId = await variantOf('demo-full-cream-milk-1l');

    await expect(service().addItem(EMPTY, variantId, 26, EN)).rejects.toSatisfy(
      (error) => codeOf(error) === 'QUANTITY_LIMIT_EXCEEDED'
    );
  });

  it('counts the EXISTING quantity when checking stock', async () => {
    // Floor cleaner has 15. Two adds of 8 must fail on the second (16 > 15), not
    // pass because each add is individually under the limit.
    const variantId = await variantOf('demo-cleaning-liquid-1l');
    const cart = service();

    const first = await cart.addItem(EMPTY, variantId, 8, EN);

    await expect(cart.addItem(first, variantId, 8, EN)).rejects.toSatisfy(
      (error) => codeOf(error) === 'INSUFFICIENT_STOCK'
    );
  });

  it('enforces the per-line quantity guardrail', async () => {
    const variantId = await variantOf('demo-toor-dal-1kg'); // stock 60

    await expect(
      service().addItem(EMPTY, variantId, MAX_QUANTITY_PER_LINE + 1, EN)
    ).rejects.toSatisfy((error) => codeOf(error) === 'QUANTITY_LIMIT_EXCEEDED');
  });

  it('allows exactly the guardrail quantity', async () => {
    const variantId = await variantOf('demo-toor-dal-1kg');
    const next = await service().addItem(EMPTY, variantId, MAX_QUANTITY_PER_LINE, EN);

    expect(next.lines[0]!.quantity).toBe(MAX_QUANTITY_PER_LINE);
  });

  it('rejects a zero or negative quantity', async () => {
    const variantId = await variantOf('demo-atta-5kg');

    await expect(service().addItem(EMPTY, variantId, 0, EN)).rejects.toThrow();
    await expect(service().addItem(EMPTY, variantId, -1, EN)).rejects.toThrow();
  });

  it('rejects a fractional quantity', async () => {
    const variantId = await variantOf('demo-atta-5kg');

    await expect(service().addItem(EMPTY, variantId, 1.5, EN)).rejects.toThrow();
  });

  it('leaves the cart UNCHANGED when an add is rejected', async () => {
    // A failed add must not half-mutate the cart.
    const good = await variantOf('demo-atta-5kg');
    const bad = await variantOf('demo-tomatoes-1kg');
    const cart = service();

    const withItem = await cart.addItem(EMPTY, good, 1, EN);
    await expect(cart.addItem(withItem, bad, 1, EN)).rejects.toThrow();

    expect(withItem.lines).toHaveLength(1);
    expect(withItem.lines[0]!.variantId).toBe(good);
  });
});

describe('D-11 single-vendor cart', () => {
  it('allows two items from the SAME store', async () => {
    const atta = await variantOf('demo-atta-5kg');
    const dal = await variantOf('demo-toor-dal-1kg');
    const cart = service();

    const first = await cart.addItem(EMPTY, atta, 1, EN);
    const second = await cart.addItem(first, dal, 1, EN);

    expect(second.lines).toHaveLength(2);
  });

  it('releases the store lock when the cart is emptied', async () => {
    const atta = await variantOf('demo-atta-5kg');
    const cart = service();

    const added = await cart.addItem(EMPTY, atta, 1, EN);
    const removed = cart.removeItem(added, atta);

    // Otherwise the customer could never switch stores without clearing cookies.
    expect(removed.storeId).toBeNull();
    expect(removed.lines).toEqual([]);
  });

  it('keeps the store lock while items remain', async () => {
    const atta = await variantOf('demo-atta-5kg');
    const dal = await variantOf('demo-toor-dal-1kg');
    const cart = service();

    const two = await cart.addItem(await cart.addItem(EMPTY, atta, 1, EN), dal, 1, EN);
    const one = cart.removeItem(two, atta);

    expect(one.storeId).not.toBeNull();
  });
});

describe('setQuantity', () => {
  it('sets an exact quantity', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const cart = service();

    const added = await cart.addItem(EMPTY, variantId, 2, EN);
    const updated = await cart.setQuantity(added, variantId, 5, EN);

    expect(updated.lines[0]!.quantity).toBe(5);
  });

  it('REMOVES the line at zero, as a stepper expects', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const cart = service();

    const added = await cart.addItem(EMPTY, variantId, 2, EN);
    const updated = await cart.setQuantity(added, variantId, 0, EN);

    expect(updated.lines).toEqual([]);
    expect(updated.storeId).toBeNull();
  });

  it('rejects a quantity above available stock', async () => {
    const variantId = await variantOf('demo-cleaning-liquid-1l'); // stock 15
    const cart = service();

    const added = await cart.addItem(EMPTY, variantId, 1, EN);

    await expect(cart.setQuantity(added, variantId, 16, EN)).rejects.toSatisfy(
      (error) => codeOf(error) === 'INSUFFICIENT_STOCK'
    );
  });

  it('rejects a line that is not in the cart', async () => {
    const variantId = await variantOf('demo-atta-5kg');

    await expect(service().setQuantity(EMPTY, variantId, 2, EN)).rejects.toThrow(
      /not in your cart/i
    );
  });

  it('rejects a negative quantity', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const cart = service();
    const added = await cart.addItem(EMPTY, variantId, 1, EN);

    await expect(cart.setQuantity(added, variantId, -1, EN)).rejects.toThrow();
  });
});

describe('removeItem and clear', () => {
  it('removes one line and leaves the others', async () => {
    const atta = await variantOf('demo-atta-5kg');
    const dal = await variantOf('demo-toor-dal-1kg');
    const cart = service();

    const two = await cart.addItem(await cart.addItem(EMPTY, atta, 1, EN), dal, 1, EN);
    const one = cart.removeItem(two, atta);

    expect(one.lines.map((line) => line.variantId)).toEqual([dal]);
  });

  it('is a no-op for a line that is not present', async () => {
    const atta = await variantOf('demo-atta-5kg');
    const cart = service();
    const added = await cart.addItem(EMPTY, atta, 1, EN);

    expect(cart.removeItem(added, 'not-in-cart').lines).toHaveLength(1);
  });

  it('clear empties everything including the coupon', () => {
    const cleared = service().clear();

    expect(cleared).toEqual({ storeId: null, lines: [], couponCode: null });
  });
});

describe('view — prices come from the database', () => {
  it('prices lines from the catalogue, not from the intent', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const cart = service();
    const intent = await cart.addItem(EMPTY, variantId, 2, EN);

    const view = await cart.view(intent, SERVICEABLE);

    // The intent carries only variantId + quantity; ₹289 comes from the DB.
    expect(view.lines[0]!.unitPricePaise).toBe(28_900);
    expect(view.lines[0]!.lineTotalPaise).toBe(57_800);
    expect(view.totals.grossAmountPaise).toBe(57_800);
  });

  it('computes the delivery fee and waives it over the threshold', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const cart = service();
    const intent = await cart.addItem(EMPTY, variantId, 1, EN);

    const view = await cart.view(intent, SERVICEABLE);

    // ₹289 is above the ₹199 threshold.
    expect(view.totals.deliveryFeePaise).toBe(0);
    expect(view.totals.isDeliveryFree).toBe(true);
    expect(view.totals.totalAmountPaise).toBe(28_900);
  });

  it('charges delivery below the threshold and reports the gap', async () => {
    const variantId = await variantOf('demo-toor-dal-1kg'); // ₹175
    const cart = service();
    const intent = await cart.addItem(EMPTY, variantId, 1, EN);

    const view = await cart.view(intent, SERVICEABLE);

    expect(view.totals.deliveryFeePaise).toBe(2_500);
    expect(view.totals.freeDeliveryGapPaise).toBe(2_400);
    expect(view.totals.totalAmountPaise).toBe(20_000);
  });

  it('never renders a tax line while D-14 is blocked', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const cart = service();
    const intent = await cart.addItem(EMPTY, variantId, 1, EN);

    const view = await cart.view(intent, SERVICEABLE);

    expect(view.totals.taxAmountPaise).toBe(0);
    expect(view.totals.isTaxDisplayable).toBe(false);
  });

  it('reports an ETA for a serviceable location', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const cart = service();
    const intent = await cart.addItem(EMPTY, variantId, 1, EN);

    const view = await cart.view(intent, SERVICEABLE);

    expect(view.etaMinMinutes).toBeGreaterThan(0);
    expect(view.etaMaxMinutes).toBeGreaterThan(view.etaMinMinutes!);
  });

  it('localises product names', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const cart = service();
    const intent = await cart.addItem(EMPTY, variantId, 1, EN);

    const view = await cart.view(intent, { locale: 'hi', pincode: '452001' });

    expect(view.lines[0]!.productName).toBe('डेमो गेहूँ का आटा');
  });
});

describe('view — blocking issues', () => {
  it('flags an empty cart', async () => {
    const view = await service().view(EMPTY, SERVICEABLE);

    expect(view.issues.map((issue) => issue.code)).toContain('CART_EMPTY');
  });

  it('requires a location before checkout', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const cart = service();
    const intent = await cart.addItem(EMPTY, variantId, 1, EN);

    const view = await cart.view(intent, { locale: 'en' });

    // Without a zone there is no fee and no ETA, so the quote is incomplete.
    expect(view.issues.map((issue) => issue.code)).toContain('LOCATION_REQUIRED');
    expect(view.totals.isQuoteIncomplete).toBe(true);
  });

  it('flags an unserviceable pincode', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const cart = service();
    const intent = await cart.addItem(EMPTY, variantId, 1, EN);

    const view = await cart.view(intent, { locale: 'en', pincode: '110001' });

    expect(view.issues.map((issue) => issue.code)).toContain('NOT_SERVICEABLE');
  });

  it('flags a cart below the store minimum', async () => {
    // One toor dal at ₹175 clears ₹99, so use a cheaper single item: bananas ₹49.
    const variantId = await variantOf('demo-bananas-6pc');
    const cart = service();
    const intent = await cart.addItem(EMPTY, variantId, 1, EN);

    const view = await cart.view(intent, SERVICEABLE);

    const issue = view.issues.find((entry) => entry.code === 'MIN_ORDER_NOT_MET');
    expect(issue).toBeDefined();
    expect(view.totals.meetsMinimumOrder).toBe(false);
  });

  it('has NO issues for a valid, serviceable cart above the minimum', async () => {
    const variantId = await variantOf('demo-atta-5kg');
    const cart = service();
    const intent = await cart.addItem(EMPTY, variantId, 1, EN);

    const view = await cart.view(intent, SERVICEABLE);

    expect(view.issues).toEqual([]);
    expect(view.hasLineIssues).toBe(false);
  });

  it('KEEPS a line that went out of stock, flagged rather than removed', async () => {
    // Silently dropping items looks like a bug and loses the rest of the intent.
    const tomatoes = await variantOf('demo-tomatoes-1kg');
    const cart = service();

    // Bypass addItem's guard to simulate stock disappearing after the add.
    const intent: CartIntent = {
      storeId: 'store',
      lines: [{ variantId: tomatoes, quantity: 2 }],
      couponCode: null,
    };

    const view = await cart.view(intent, SERVICEABLE);

    expect(view.lines).toHaveLength(1);
    expect(view.hasLineIssues).toBe(true);
    expect(view.lines[0]!.issues.map((issue) => issue.code)).toContain('INSUFFICIENT_STOCK');
  });

  it('drops a variant that no longer exists at all', async () => {
    const intent: CartIntent = {
      storeId: 'store',
      lines: [{ variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
      couponCode: null,
    };

    const view = await service().view(intent, SERVICEABLE);

    // Nothing can be shown or priced for a vanished variant.
    expect(view.lines).toEqual([]);
  });
});

describe('countItems', () => {
  it('counts units, not lines', async () => {
    const atta = await variantOf('demo-atta-5kg');
    const dal = await variantOf('demo-toor-dal-1kg');
    const cart = service();

    const intent = await cart.addItem(await cart.addItem(EMPTY, atta, 2, EN), dal, 3, EN);

    expect(cart.countItems(intent)).toBe(5);
  });

  it('is zero for an empty cart', () => {
    expect(service().countItems(EMPTY)).toBe(0);
  });
});

describe('merge', () => {
  it('returns the user cart when the guest cart is empty', () => {
    const user: CartIntent = {
      storeId: 's1',
      lines: [{ variantId: 'v1', quantity: 1 }],
      couponCode: null,
    };

    expect(service().merge(user, EMPTY)).toEqual(user);
  });

  it('returns the guest cart when the user cart is empty', () => {
    const guest: CartIntent = {
      storeId: 's1',
      lines: [{ variantId: 'v1', quantity: 2 }],
      couponCode: null,
    };

    expect(service().merge(EMPTY, guest)).toEqual(guest);
  });

  it('ADDS quantities for the same variant', () => {
    const user: CartIntent = {
      storeId: 's1',
      lines: [{ variantId: 'v1', quantity: 2 }],
      couponCode: null,
    };
    const guest: CartIntent = {
      storeId: 's1',
      lines: [{ variantId: 'v1', quantity: 3 }],
      couponCode: null,
    };

    expect(service().merge(user, guest).lines).toEqual([{ variantId: 'v1', quantity: 5 }]);
  });

  it('clamps a merged quantity to the guardrail', () => {
    const user: CartIntent = {
      storeId: 's1',
      lines: [{ variantId: 'v1', quantity: 15 }],
      couponCode: null,
    };
    const guest: CartIntent = {
      storeId: 's1',
      lines: [{ variantId: 'v1', quantity: 15 }],
      couponCode: null,
    };

    expect(service().merge(user, guest).lines[0]!.quantity).toBe(MAX_QUANTITY_PER_LINE);
  });

  it('unions different variants', () => {
    const user: CartIntent = {
      storeId: 's1',
      lines: [{ variantId: 'v1', quantity: 1 }],
      couponCode: null,
    };
    const guest: CartIntent = {
      storeId: 's1',
      lines: [{ variantId: 'v2', quantity: 1 }],
      couponCode: null,
    };

    expect(service().merge(user, guest).lines).toHaveLength(2);
  });

  it('KEEPS THE USER CART when the stores differ (D-11)', () => {
    // Mixing would create an unorderable cart; replacing a signed-in customer's
    // cart with an anonymous one is worse.
    const user: CartIntent = {
      storeId: 's1',
      lines: [{ variantId: 'v1', quantity: 1 }],
      couponCode: null,
    };
    const guest: CartIntent = {
      storeId: 's2',
      lines: [{ variantId: 'v9', quantity: 1 }],
      couponCode: null,
    };

    expect(service().merge(user, guest)).toEqual(user);
  });

  it('prefers the user coupon over the guest one', () => {
    const user: CartIntent = {
      storeId: 's1',
      lines: [{ variantId: 'v1', quantity: 1 }],
      couponCode: 'USER',
    };
    const guest: CartIntent = {
      storeId: 's1',
      lines: [{ variantId: 'v2', quantity: 1 }],
      couponCode: 'GUEST',
    };

    expect(service().merge(user, guest).couponCode).toBe('USER');
  });
});
