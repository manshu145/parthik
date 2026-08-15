import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { CouponService } from '@/modules/coupons/coupon.service';
import { InMemoryCouponRepository } from '@/modules/coupons/coupon-memory.repository';
import type { CouponRepository } from '@/modules/coupons/coupon.repository.types';
import type { Coupon, CouponCartLine } from '@/modules/coupons/coupon.types';
import { CatalogService } from '@/modules/catalog/catalog.service';
import { InMemoryCatalogRepository } from '@/modules/catalog/catalog-memory.repository';
import { LocationService } from '@/modules/location/location.service';
import { InMemoryLocationRepository } from '@/modules/location/location-memory.repository';
import { mockMapsProvider } from '@/lib/maps/mock-provider';
import { CartService } from '@/modules/cart/cart.service';
import type { CartIntent } from '@/modules/cart/cart.types';

/**
 * Coupon service and cart integration.
 *
 * The engine's rules are covered exhaustively in `coupon-engine.test.ts`. What is
 * tested here is the wiring around it: which error code and status a refusal
 * becomes, what the customer is told, that a cart re-checks its coupon on every read
 * rather than trusting a stored decision, and that the discount reaching the totals
 * is the one the engine approved.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z');

function line(overrides: Partial<CouponCartLine> = {}): CouponCartLine {
  return {
    id: 'line-1',
    variantId: 'variant-1',
    productId: 'product-1',
    categoryId: 'category-1',
    vendorId: 'vendor-1',
    lineTotalPaise: 50_000,
    ...overrides,
  };
}

/** A repository stub whose single coupon is described inline by each test. */
function repositoryWith(
  coupon: Coupon | null,
  facts: { isFirstOrder?: boolean; userUsages?: number } = {}
): CouponRepository {
  return {
    findByCode: (code) => Promise.resolve(coupon && coupon.code === code ? coupon : null),
    countUserUsages: () => Promise.resolve(facts.userUsages ?? 0),
    isFirstOrder: () => Promise.resolve(facts.isFirstOrder ?? true),
    listPublicOffers: () => Promise.resolve([]),
  };
}

function couponRow(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'coupon-1',
    code: 'SAVE50',
    couponType: 'FLAT',
    discountValue: 5_000,
    maxDiscountPaise: null,
    minCartPaise: 0,
    scope: 'CART',
    firstOrderOnly: false,
    isUserSpecific: false,
    usageLimitTotal: null,
    usageLimitPerUser: null,
    usedCount: 0,
    validFrom: null,
    validUntil: null,
    isActive: true,
    isStackable: false,
    restrictions: [],
    ...overrides,
  };
}

function service(repository: CouponRepository): CouponService {
  return new CouponService({ repository, now: () => NOW });
}

const INPUT = {
  lines: [line()],
  userId: 'user-1',
  zoneId: 'zone-1',
  locale: 'en' as const,
};

async function captureError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('Expected the call to throw.');
}

// ---------------------------------------------------------------------------
// Code normalisation
// ---------------------------------------------------------------------------

describe('code normalisation', () => {
  it.each(['save50', 'SAVE50', '  save50  ', 'Save50'])('accepts %s', async (typed) => {
    // Customers type codes and paste them from messages. Case and stray whitespace
    // must not be the difference between a discount and a refusal.
    const result = await service(repositoryWith(couponRow())).apply({ ...INPUT, code: typed });

    expect(result.code).toBe('SAVE50');
  });

  it('uppercases and trims through the static helper', () => {
    expect(CouponService.normaliseCode('  demofirst50 ')).toBe('DEMOFIRST50');
  });
});

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

describe('applying a coupon', () => {
  it('returns a discount the pricing engine can consume', async () => {
    const result = await service(repositoryWith(couponRow())).apply({ ...INPUT, code: 'SAVE50' });

    expect(result).toEqual({
      couponId: 'coupon-1',
      code: 'SAVE50',
      amountPaise: 5_000,
      waivesDeliveryFee: false,
      // Always present, so pricing never has to guess which lines a coupon covers.
      eligibleLineIds: ['line-1'],
    });
  });

  it('marks a free-delivery coupon as waiving the fee, not discounting items', async () => {
    const result = await service(
      repositoryWith(couponRow({ code: 'FREEDEL', couponType: 'FREE_DELIVERY', discountValue: 0 }))
    ).apply({ ...INPUT, code: 'FREEDEL' });

    expect(result).toMatchObject({ amountPaise: 0, waivesDeliveryFee: true });
  });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe('refusals', () => {
  it('returns 404 for a code that does not exist', async () => {
    // A different fix for the customer than a code that exists but does not apply,
    // so it gets a different status.
    const error = await captureError(
      service(repositoryWith(null)).apply({ ...INPUT, code: 'NOPE' })
    );

    expect(error.code).toBe('NOT_FOUND');
    expect(error.status).toBe(404);
  });

  it('returns 400 with the documented code for a rule violation', async () => {
    const error = await captureError(
      service(repositoryWith(couponRow({ minCartPaise: 80_000 }))).apply({
        ...INPUT,
        code: 'SAVE50',
      })
    );

    expect(error.code).toBe('COUPON_MIN_CART_NOT_MET');
    expect(error.status).toBe(400);
  });

  it('tells the customer exactly how much more to add', async () => {
    const error = await captureError(
      service(repositoryWith(couponRow({ minCartPaise: 62_000 }))).apply({
        ...INPUT,
        code: 'SAVE50',
      })
    );

    // ₹620 minimum − ₹500 cart = ₹120 short. docs/API_SPEC.md §5 shows this exact
    // message shape.
    expect(error.publicMessage).toContain('120');
  });

  it('returns machine-readable details alongside the message', async () => {
    const error = await captureError(
      service(repositoryWith(couponRow({ minCartPaise: 62_000 }))).apply({
        ...INPUT,
        code: 'SAVE50',
      })
    );

    // docs/API_SPEC.md §1.3: the client switches on `code` and can render its own
    // copy from `details` rather than parsing the message.
    expect(error.toJSON()).toMatchObject({
      code: 'COUPON_MIN_CART_NOT_MET',
      details: { minCartPaise: 62_000, shortfallPaise: 12_000 },
    });
  });

  it('omits details when there are none to give', async () => {
    const error = await captureError(
      service(repositoryWith(couponRow({ isActive: false }))).apply({ ...INPUT, code: 'SAVE50' })
    );

    expect(error.toJSON()).not.toHaveProperty('details');
  });

  it.each([
    ['COUPON_EXPIRED', { validUntil: new Date('2026-01-01T00:00:00.000Z') }],
    ['COUPON_INACTIVE', { isActive: false }],
    ['COUPON_USAGE_LIMIT_REACHED', { usageLimitTotal: 1, usedCount: 1 }],
    ['COUPON_FIRST_ORDER_ONLY', { firstOrderOnly: true }],
    [
      'COUPON_ZONE_RESTRICTED',
      { restrictions: [{ restrictionType: 'ZONE' as const, restrictionId: 'zone-9' }] },
    ],
  ])('surfaces %s', async (expected, overrides) => {
    const repository = repositoryWith(couponRow(overrides), { isFirstOrder: false });
    const error = await captureError(service(repository).apply({ ...INPUT, code: 'SAVE50' }));

    expect(error.code).toBe(expected);
  });

  it('gives every refusal a message that is safe to display', async () => {
    for (const overrides of [
      { isActive: false },
      { validUntil: new Date('2026-01-01T00:00:00.000Z') },
      { usageLimitTotal: 1, usedCount: 1 },
      { firstOrderOnly: true },
      { usageLimitPerUser: 1 },
      { minCartPaise: 90_000 },
      { restrictions: [{ restrictionType: 'ZONE' as const, restrictionId: 'zone-9' }] },
      { restrictions: [{ restrictionType: 'CATEGORY' as const, restrictionId: 'nope' }] },
    ]) {
      const repository = repositoryWith(couponRow(overrides), {
        isFirstOrder: false,
        userUsages: 5,
      });
      const error = await captureError(service(repository).apply({ ...INPUT, code: 'SAVE50' }));

      // No blank messages, and nothing that leaks an internal identifier.
      expect(error.publicMessage.length).toBeGreaterThan(10);
      expect(error.publicMessage).not.toContain('coupon-1');
    }
  });
});

// ---------------------------------------------------------------------------
// evaluate() vs apply()
// ---------------------------------------------------------------------------

describe('evaluate does not throw', () => {
  it('reports an unknown code as a verdict', async () => {
    const result = await service(repositoryWith(null)).evaluate({ ...INPUT, code: 'NOPE' });

    expect(result).toEqual({ isApplicable: false, code: 'NOPE', reason: 'COUPON_NOT_FOUND' });
  });

  it('reports a rule violation as a verdict', async () => {
    const result = await service(repositoryWith(couponRow({ isActive: false }))).evaluate({
      ...INPUT,
      code: 'SAVE50',
    });

    expect(result).toMatchObject({ isApplicable: false, reason: 'COUPON_INACTIVE' });
  });
});

describe('user facts are fetched only when a rule needs them', () => {
  it('skips both lookups for a plain cart coupon', async () => {
    let calls = 0;
    const repository: CouponRepository = {
      findByCode: () => Promise.resolve(couponRow()),
      countUserUsages: () => {
        calls += 1;
        return Promise.resolve(0);
      },
      isFirstOrder: () => {
        calls += 1;
        return Promise.resolve(true);
      },
      listPublicOffers: () => Promise.resolve([]),
    };

    await service(repository).apply({ ...INPUT, code: 'SAVE50' });

    // A cart read should not cost two extra queries for rules the coupon does not
    // have.
    expect(calls).toBe(0);
  });

  it('fetches first-order status when the coupon requires it', async () => {
    let asked = false;
    const repository: CouponRepository = {
      findByCode: () => Promise.resolve(couponRow({ firstOrderOnly: true })),
      countUserUsages: () => Promise.resolve(0),
      isFirstOrder: () => {
        asked = true;
        return Promise.resolve(true);
      },
      listPublicOffers: () => Promise.resolve([]),
    };

    await service(repository).apply({ ...INPUT, code: 'SAVE50' });

    expect(asked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// In-memory fixtures
// ---------------------------------------------------------------------------

describe('in-memory repository', () => {
  const repository = new InMemoryCouponRepository();

  it('serves the seeded demo codes', async () => {
    expect(await repository.findByCode('DEMOFIRST50')).toMatchObject({
      code: 'DEMOFIRST50',
      couponType: 'FLAT',
      firstOrderOnly: true,
    });
  });

  it('matches codes case-insensitively', async () => {
    expect(await repository.findByCode('demofreedel')).not.toBeNull();
  });

  it('returns null for an unknown code rather than throwing', async () => {
    expect(await repository.findByCode('NOSUCHCODE')).toBeNull();
  });

  it('derives restriction ids that match the catalogue', async () => {
    // The scoped fixture must point at the SAME category id the in-memory catalog
    // serves, or a category coupon would silently apply to nothing.
    const scoped = await repository.findByCode('DEMOSTAPLES15');
    const catalog = new CatalogService({ repository: new InMemoryCatalogRepository() });
    const tree = await catalog.getCategoryTree('en');
    const ids = new Set(tree.flatMap((node) => [node.id, ...node.children.map((c) => c.id)]));

    expect(scoped?.restrictions).toHaveLength(1);
    expect(ids.has(scoped!.restrictions[0]!.restrictionId)).toBe(true);
  });

  it('lists offers cheapest-to-unlock first', async () => {
    const offers = await repository.listPublicOffers({ locale: 'en' });
    const minimums = offers.map((offer) => offer.minCartPaise);

    expect(minimums).toEqual([...minimums].sort((a, b) => a - b));
  });

  it('localises offer copy, with an English fallback', async () => {
    const [en, hi] = await Promise.all([
      repository.listPublicOffers({ locale: 'en' }),
      repository.listPublicOffers({ locale: 'hi' }),
    ]);

    expect(en).toHaveLength(hi.length);
    for (const offer of hi) {
      expect(offer.name.length).toBeGreaterThan(0);
    }
    // Genuinely different copy, not the English string echoed back.
    expect(hi[0]?.name).not.toBe(en[0]?.name);
  });
});

// ---------------------------------------------------------------------------
// Cart integration
// ---------------------------------------------------------------------------

describe('cart integration', () => {
  function cart() {
    const catalog = new CatalogService({ repository: new InMemoryCatalogRepository() });
    const location = new LocationService({
      repository: new InMemoryLocationRepository(),
      maps: mockMapsProvider,
    });
    const coupons = new CouponService({ repository: new InMemoryCouponRepository() });

    return new CartService({ catalog, location, coupons });
  }

  const EMPTY: CartIntent = { storeId: null, lines: [], couponCode: null };
  /**
   * A SIGNED-IN customer. `DEMOFIRST50` is first-order-only, and the engine refuses
   * user-scoped rules without an identity — see the guest test below, which is the
   * behaviour, not a limitation of the fixture.
   */
  const CONTEXT = { locale: 'en' as const, pincode: '452001', userId: 'user-1' };

  async function variantOf(slug: string): Promise<string> {
    const catalog = new CatalogService({ repository: new InMemoryCatalogRepository() });
    const page = await catalog.getProductPage(slug, 'en');
    return page!.product.variants[0]!.id;
  }

  /** A cart holding enough atta to clear the demo minimums. */
  async function stockedCart(quantity = 2): Promise<CartIntent> {
    const service = cart();
    const variantId = await variantOf('demo-atta-5kg');
    return service.addItem(EMPTY, variantId, quantity, CONTEXT);
  }

  it('reports no coupon on a cart that has none', async () => {
    const view = await cart().view(await stockedCart(), CONTEXT);

    expect(view.coupon).toBeNull();
    expect(view.totals.couponDiscountPaise).toBe(0);
  });

  it('applies a flat coupon to the totals', async () => {
    const service = cart();
    const intent = await service.applyCoupon(await stockedCart(), 'DEMOFIRST50', CONTEXT);
    const view = await service.view(intent, CONTEXT);

    expect(view.coupon).toMatchObject({ code: 'DEMOFIRST50', isApplied: true });
    expect(view.totals.couponDiscountPaise).toBe(5_000);
  });

  it('reduces the payable total by exactly the discount', async () => {
    const service = cart();
    const stocked = await stockedCart();
    const before = await service.view(stocked, CONTEXT);
    const after = await service.view(
      await service.applyCoupon(stocked, 'DEMOFIRST50', CONTEXT),
      CONTEXT
    );

    // Delivery is already free at this cart value in the demo zone, so the whole
    // difference is the coupon — if this drifts, the coupon is changing something
    // else too.
    expect(before.totals.totalAmountPaise - after.totals.totalAmountPaise).toBe(5_000);
  });

  it('waives the delivery fee for a free-delivery coupon and says so', async () => {
    const service = cart();
    // Two litres of milk is ₹144: above the coupon's ₹99 minimum but below the
    // zone's ₹199 free-delivery threshold, so there is genuinely a fee to waive.
    // Any atta cart already clears the threshold and would prove nothing.
    const stocked = await service.addItem(
      EMPTY,
      await variantOf('demo-full-cream-milk-1l'),
      2,
      CONTEXT
    );
    const intent = await service.applyCoupon(stocked, 'DEMOFREEDEL', CONTEXT);
    const view = await service.view(intent, CONTEXT);

    expect(view.totals.deliveryFeeBeforeDiscountPaise).toBeGreaterThan(0);

    expect(view.coupon).toMatchObject({ isApplied: true, waivesDeliveryFee: true });
    expect(view.totals.isDeliveryFree).toBe(true);
    // The UI needs the reason, not just a zero.
    expect(view.totals.deliveryWaivedBy).toBe('coupon');
  });

  it('allocates the discount across lines so the parts equal the whole', async () => {
    const service = cart();
    let intent = await stockedCart();
    intent = await service.addItem(intent, await variantOf('demo-toor-dal-1kg'), 1, CONTEXT);
    intent = await service.applyCoupon(intent, 'DEMOFIRST50', CONTEXT);

    const view = await service.view(intent, CONTEXT);
    const allocated = view.lines.reduce((sum, l) => sum + l.couponDiscountPaise, 0);

    expect(allocated).toBe(view.totals.couponDiscountPaise);
  });

  it('refuses to store a coupon that cannot be applied', async () => {
    const service = cart();
    // DEMOSAVE10 needs a ₹299 cart; one banana bunch is nowhere near.
    const small = await service.addItem(EMPTY, await variantOf('demo-bananas-6pc'), 1, CONTEXT);

    const error = await captureError(service.applyCoupon(small, 'DEMOSAVE10', CONTEXT));

    expect(error.code).toBe('COUPON_MIN_CART_NOT_MET');
  });

  it('re-checks the coupon on every read and drops it when it stops applying', async () => {
    const service = cart();
    const variantId = await variantOf('demo-atta-5kg');

    // Qualifies for the ₹299 minimum with two units.
    let intent = await service.addItem(EMPTY, variantId, 2, CONTEXT);
    intent = await service.applyCoupon(intent, 'DEMOSAVE10', CONTEXT);
    expect((await service.view(intent, CONTEXT)).coupon?.isApplied).toBe(true);

    // Removing a unit drops the cart below the minimum. The coupon must not keep
    // discounting, and must not vanish silently either.
    intent = await service.setQuantity(intent, variantId, 1, CONTEXT);
    const view = await service.view(intent, CONTEXT);

    expect(view.coupon).toMatchObject({
      code: 'DEMOSAVE10',
      isApplied: false,
      reason: 'COUPON_MIN_CART_NOT_MET',
    });
    expect(view.totals.couponDiscountPaise).toBe(0);
  });

  it('does not let a dropped coupon block checkout', async () => {
    // A coupon that no longer applies is not a blocking cart issue — the customer
    // can still order, just without the discount.
    const service = cart();
    const variantId = await variantOf('demo-atta-5kg');
    let intent = await service.addItem(EMPTY, variantId, 2, CONTEXT);
    intent = await service.applyCoupon(intent, 'DEMOSAVE10', CONTEXT);
    intent = await service.setQuantity(intent, variantId, 1, CONTEXT);

    const view = await service.view(intent, CONTEXT);

    expect(view.issues).toEqual([]);
  });

  it('applies a category-scoped coupon to the matching line only', async () => {
    const service = cart();
    let intent = await stockedCart();
    // Milk is not a staple, so it must not be discounted.
    intent = await service.addItem(intent, await variantOf('demo-full-cream-milk-1l'), 1, CONTEXT);
    intent = await service.applyCoupon(intent, 'DEMOSTAPLES15', CONTEXT);

    const view = await service.view(intent, CONTEXT);
    const milk = view.lines.find((l) => l.productSlug === 'demo-full-cream-milk-1l');
    const atta = view.lines.find((l) => l.productSlug === 'demo-atta-5kg');

    expect(view.coupon?.isApplied).toBe(true);
    expect(milk?.couponDiscountPaise).toBe(0);
    expect(atta?.couponDiscountPaise).toBe(view.totals.couponDiscountPaise);
  });

  it('removes a coupon on request', async () => {
    const service = cart();
    const intent = await service.applyCoupon(await stockedCart(), 'DEMOFIRST50', CONTEXT);
    const view = await service.view(service.removeCoupon(intent), CONTEXT);

    expect(view.coupon).toBeNull();
    expect(view.totals.couponDiscountPaise).toBe(0);
  });

  it('releases the coupon when the cart is emptied', async () => {
    const service = cart();
    const variantId = await variantOf('demo-atta-5kg');
    let intent = await service.addItem(EMPTY, variantId, 2, CONTEXT);
    intent = await service.applyCoupon(intent, 'DEMOFIRST50', CONTEXT);

    // Same reasoning as the D-11 store lock: an empty cart carries no state.
    expect(service.removeItem(intent, variantId).couponCode).toBeNull();
  });

  it('refuses a coupon on an empty cart', async () => {
    const error = await captureError(cart().applyCoupon(EMPTY, 'DEMOFIRST50', CONTEXT));

    expect(error.code).toBe('CART_EMPTY');
  });

  it('keeps the coupon through a guest-to-user merge', async () => {
    const service = cart();
    const guest = await service.applyCoupon(await stockedCart(), 'DEMOFIRST50', CONTEXT);

    expect(service.merge(EMPTY, guest).couponCode).toBe('DEMOFIRST50');
  });

  it('refuses a first-order coupon for a guest', async () => {
    // No session means no order history to check, so the coupon cannot be verified.
    // Granting it would make it reusable indefinitely by staying signed out — this
    // is the reason `/cart/coupon` is a CUSTOMER endpoint in docs/API_SPEC.md §5.
    const service = cart();
    const guestContext = { locale: 'en' as const, pincode: '452001' };

    const error = await captureError(
      service.applyCoupon(
        await service.addItem(EMPTY, await variantOf('demo-atta-5kg'), 2, guestContext),
        'DEMOFIRST50',
        guestContext
      )
    );

    expect(error.code).toBe('COUPON_NOT_APPLICABLE');
  });

  it('lets a guest use a coupon with no user-scoped rules', async () => {
    // The preview has no authentication, so this is the path a visitor can actually
    // exercise today.
    const service = cart();
    const guestContext = { locale: 'en' as const, pincode: '452001' };
    const stocked = await service.addItem(EMPTY, await variantOf('demo-atta-5kg'), 2, guestContext);

    const intent = await service.applyCoupon(stocked, 'DEMOSAVE10', guestContext);
    const view = await service.view(intent, guestContext);

    expect(view.coupon).toMatchObject({ code: 'DEMOSAVE10', isApplied: true });
    expect(view.totals.couponDiscountPaise).toBeGreaterThan(0);
  });
});
