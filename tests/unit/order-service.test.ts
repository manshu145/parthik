import { beforeEach, describe, expect, it } from 'vitest';
import { mockMapsProvider } from '@/lib/maps/mock-provider';
import { CartService } from '@/modules/cart/cart.service';
import type { CartIntent } from '@/modules/cart/cart.types';
import { CatalogService } from '@/modules/catalog/catalog.service';
import { InMemoryCatalogRepository } from '@/modules/catalog/catalog-memory.repository';
import { CheckoutService } from '@/modules/checkout/checkout.service';
import { CouponService } from '@/modules/coupons/coupon.service';
import { InMemoryCouponRepository } from '@/modules/coupons/coupon-memory.repository';
import { CustomerService } from '@/modules/customer/customer.service';
import {
  InMemoryCustomerRepository,
  resetInMemoryAddressesForTests,
} from '@/modules/customer/customer-memory.repository';
import { LocationService } from '@/modules/location/location.service';
import { InMemoryLocationRepository } from '@/modules/location/location-memory.repository';
import { OrderService } from '@/modules/order/order.service';
import type {
  CreateOrderInput,
  OrderDetail,
  OrderRecord,
  OrderRepository,
  OrderStatusEvent,
  StockShortfall,
  TransitionInput,
} from '@/modules/order/order.repository.types';
import { requireTransition, type OrderStatus } from '@/modules/order/order.state';
import { resetSettingsCacheForTests } from '@/modules/settings';

/**
 * Order service tests.
 *
 * The service owns three things, and each one is a way real money goes missing:
 *
 *   IDEMPOTENCY  a double-click must not create two orders
 *   RE-QUOTING   the price charged must be recomputed, not trusted from the client
 *   TRANSITIONS  nothing may write `orders.status` without the state machine and the policy
 *
 * The repository here is a FAKE, and that is the point — these tests are about the decisions
 * the service makes, not the SQL. The SQL is verified separately against a real PostgreSQL
 * container by scripts/check-commerce-queries.ts, because a fake cannot tell you that a
 * correlated subquery resolved against the wrong table.
 */

const USER = 'user-order-1';
const OTHER_USER = 'user-order-2';
const SERVICEABLE_PINCODE = '452001';
const UNSERVICEABLE_PINCODE = '110001';

/**
 * A fake order repository that keeps the guarantees the service depends on.
 *
 * Deliberately NOT a stub returning canned values: it enforces the unique idempotency key
 * and the from-status check, because those are the two things the service leans on. A fake
 * that accepts everything would let a broken service pass.
 */
class FakeOrderRepository implements OrderRepository {
  readonly orders = new Map<string, OrderDetail>();
  readonly createCalls: CreateOrderInput[] = [];
  readonly transitions: TransitionInput[] = [];

  /** Set to make the next create report a shortfall, as a lost stock race does. */
  shortfalls: StockShortfall[] = [];
  /** Order ids whose next transition should blow up, for the sweep's tolerance. */
  failTransitionsFor = new Set<string>();

  private sequence = 0;

  async create(
    input: CreateOrderInput
  ): Promise<{ ok: true; order: OrderRecord } | { ok: false; shortfalls: StockShortfall[] }> {
    this.createCalls.push(input);

    if (this.shortfalls.length > 0) {
      const shortfalls = this.shortfalls;
      this.shortfalls = [];
      return { ok: false, shortfalls };
    }

    for (const detail of this.orders.values()) {
      // The real guarantee is a unique index; reproducing it here keeps the replay path
      // honest instead of assuming the service checked first.
      if (keyOf(detail.order) === input.idempotencyKey) {
        throw new Error('duplicate key value violates unique constraint');
      }
    }

    this.sequence += 1;
    const isCod = input.paymentMethod === 'COD';
    const now = new Date();

    const order: OrderRecord & { idempotencyKey: string } = {
      id: `order-${this.sequence}`,
      orderNumber: `PK-2026-${String(this.sequence).padStart(6, '0')}`,
      userId: input.userId,
      storeId: input.storeId,
      vendorId: input.vendorId,
      status: isCod ? 'CONFIRMED' : 'PENDING_PAYMENT',
      deliveryAddressSnapshot: input.deliveryAddressSnapshot,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      deliveryZoneId: input.deliveryZoneId,
      grossAmountPaise: input.grossAmountPaise,
      itemDiscountPaise: input.itemDiscountPaise,
      couponCodeSnapshot: input.couponCodeSnapshot,
      couponDiscountPaise: input.couponDiscountPaise,
      taxableAmountPaise: 0,
      taxAmountPaise: 0,
      deliveryFeePaise: input.deliveryFeePaise,
      packagingFeePaise: input.packagingFeePaise,
      serviceFeePaise: input.serviceFeePaise,
      totalAmountPaise: input.totalAmountPaise,
      paymentMethod: input.paymentMethod,
      paymentStatus: isCod ? 'PENDING' : 'CREATED',
      isCod,
      codAmountPaise: isCod ? input.totalAmountPaise : null,
      placedAt: now,
      confirmedAt: isCod ? now : null,
      acceptedAt: null,
      readyAt: null,
      deliveredAt: null,
      cancelledAt: null,
      cancellationReason: null,
      cancelledByRole: null,
      estimatedDeliveryAt: input.estimatedDeliveryAt,
      customerNote: input.customerNote,
      createdAt: now,
      idempotencyKey: input.idempotencyKey,
    };

    this.orders.set(order.id, {
      order,
      lines: input.lines.map((line, index) => ({
        id: `line-${this.sequence}-${index}`,
        productId: line.productId,
        variantId: line.variantId,
        productNameSnapshot: line.productNameSnapshot,
        variantLabelSnapshot: line.variantLabelSnapshot,
        imageKeySnapshot: line.imageKeySnapshot,
        unitLabelSnapshot: line.unitLabelSnapshot,
        quantity: line.quantity,
        mrpPaise: line.mrpPaise,
        unitPricePaise: line.unitPricePaise,
        itemDiscountPaise: line.itemDiscountPaise,
        lineTotalPaise: line.lineTotalPaise,
      })),
      timeline: [event(null, order.status, 'CUSTOMER', 'Order placed')],
    });

    return { ok: true, order };
  }

  async findForUser(userId: string, orderId: string): Promise<OrderDetail | null> {
    const detail = this.orders.get(orderId);
    // Ownership is part of the lookup, exactly as the SQL scopes it.
    return detail && detail.order.userId === userId ? detail : null;
  }

  async findById(orderId: string): Promise<OrderDetail | null> {
    return this.orders.get(orderId) ?? null;
  }

  async findByOrderNumber(orderNumber: string): Promise<OrderDetail | null> {
    for (const detail of this.orders.values()) {
      if (detail.order.orderNumber === orderNumber) return detail;
    }
    return null;
  }

  async findByIdempotencyKey(key: string): Promise<OrderRecord | null> {
    for (const detail of this.orders.values()) {
      if (keyOf(detail.order) === key) return detail.order;
    }
    return null;
  }

  async listForUser(userId: string, page: { limit: number; cursor?: string | undefined }) {
    const mine = [...this.orders.values()]
      .filter((detail) => detail.order.userId === userId)
      .sort((a, b) => b.order.createdAt.getTime() - a.order.createdAt.getTime());

    const items = mine.slice(0, page.limit).map((detail) => ({
      id: detail.order.id,
      orderNumber: detail.order.orderNumber,
      status: detail.order.status,
      totalAmountPaise: detail.order.totalAmountPaise,
      itemCount: detail.lines.reduce((sum, line) => sum + line.quantity, 0),
      thumbnailKey: detail.lines[0]?.imageKeySnapshot ?? null,
      firstItemName: detail.lines[0]?.productNameSnapshot ?? '',
      createdAt: detail.order.createdAt,
      isCod: detail.order.isCod,
    }));

    return { items, nextCursor: mine.length > page.limit ? 'more' : null };
  }

  async applyTransition(input: TransitionInput): Promise<OrderRecord> {
    this.transitions.push(input);

    if (this.failTransitionsFor.has(input.orderId)) {
      throw new Error('the order moved under us');
    }

    const detail = this.orders.get(input.orderId);
    if (!detail) throw new Error('no such order');
    if (detail.order.status !== input.from) throw new Error('stale from-status');

    const now = new Date();
    const updated: OrderRecord = {
      ...detail.order,
      status: input.to,
      ...(input.to === 'CANCELLED'
        ? { cancelledAt: now, cancellationReason: input.reason, cancelledByRole: input.actor }
        : {}),
      ...(input.to === 'ACCEPTED' ? { acceptedAt: now } : {}),
      ...(input.to === 'DELIVERED' ? { deliveredAt: now } : {}),
    };

    this.orders.set(input.orderId, {
      ...detail,
      order: updated,
      timeline: [...detail.timeline, event(input.from, input.to, input.actor, input.reason)],
    });

    return updated;
  }

  async listExpiredPendingPayment(before: Date, limit: number): Promise<OrderRecord[]> {
    return [...this.orders.values()]
      .filter(
        (detail) =>
          detail.order.status === 'PENDING_PAYMENT' && detail.order.createdAt.getTime() < before.getTime()
      )
      .slice(0, limit)
      .map((detail) => detail.order);
  }
}

function keyOf(order: OrderRecord): string | undefined {
  return (order as OrderRecord & { idempotencyKey?: string }).idempotencyKey;
}

function event(
  from: OrderStatus | null,
  to: OrderStatus,
  role: string,
  reason: string | null
): OrderStatusEvent {
  return {
    id: `event-${to}-${Math.random().toString(36).slice(2, 8)}`,
    fromStatus: from,
    toStatus: to,
    changedByRole: role,
    reason,
    createdAt: new Date(),
  };
}

async function build() {
  const catalog = new CatalogService({ repository: new InMemoryCatalogRepository() });
  const location = new LocationService({
    repository: new InMemoryLocationRepository(),
    maps: mockMapsProvider,
  });
  const coupons = new CouponService({ repository: new InMemoryCouponRepository() });
  const cart = new CartService({ catalog, location, coupons });
  const customer = new CustomerService({
    repository: new InMemoryCustomerRepository({ isolated: true }),
    location,
  });
  const checkout = new CheckoutService({ cart, catalog, customer, location });
  const repository = new FakeOrderRepository();

  const address = await customer.createAddress(USER, {
    addressType: 'HOME',
    recipientName: 'Order Tester',
    recipientPhone: '+919876543210',
    line1: '1 Test Street',
    city: 'Indore',
    state: 'Madhya Pradesh',
    pincode: SERVICEABLE_PINCODE,
  });

  const variantId = (await catalog.getProductPage('demo-atta-5kg', 'en'))!.product.variants[0]!.id;
  const intent = await cart.addItem({ storeId: null, lines: [], couponCode: null }, variantId, 4, {
    locale: 'en',
  });

  return {
    service: new OrderService({ repository, checkout }),
    repository,
    customer,
    addressId: address.id,
    intent,
  };
}

function placeArgs(
  addressId: string | null,
  intent: CartIntent,
  overrides: Partial<Parameters<OrderService['placeOrder']>[0]> = {}
) {
  return {
    userId: USER,
    locale: 'en' as const,
    intent,
    addressId,
    paymentMethod: 'COD' as const,
    idempotencyKey: 'key-1',
    ...overrides,
  };
}

beforeEach(() => {
  resetInMemoryAddressesForTests();
  resetSettingsCacheForTests();
});

describe('placeOrder', () => {
  it('places a COD order that is CONFIRMED with cash to collect', async () => {
    const { service, addressId, intent } = await build();
    const { order, wasReplay } = await service.placeOrder(placeArgs(addressId, intent));

    expect(wasReplay).toBe(false);
    expect(order.status).toBe('CONFIRMED');
    expect(order.codAmountPaise).toBe(order.totalAmountPaise);
    expect(order.totalAmountPaise).toBeGreaterThan(0);
  });

  it('places a prepaid order that waits for payment and holds no cash amount', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(
      placeArgs(addressId, intent, { paymentMethod: 'UPI' })
    );

    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.codAmountPaise).toBeNull();
  });

  it('returns the SAME order for a repeated idempotency key without creating another', async () => {
    const { service, repository, addressId, intent } = await build();

    const first = await service.placeOrder(placeArgs(addressId, intent));
    const second = await service.placeOrder(placeArgs(addressId, intent));

    expect(second.wasReplay).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(second.order.orderNumber).toBe(first.order.orderNumber);
    // The decisive assertion: the repository was asked to create exactly once. A replay that
    // still reached create would double-reserve stock even if it returned the right order.
    expect(repository.createCalls).toHaveLength(1);
  });

  it('creates a second order for a different key', async () => {
    const { service, repository, addressId, intent } = await build();

    await service.placeOrder(placeArgs(addressId, intent, { idempotencyKey: 'key-a' }));
    await service.placeOrder(placeArgs(addressId, intent, { idempotencyKey: 'key-b' }));

    expect(repository.createCalls).toHaveLength(2);
  });

  it('refuses to replay another customer\u2019s idempotency key', async () => {
    const { service, addressId, intent } = await build();
    await service.placeOrder(placeArgs(addressId, intent));

    // Returning the order would be a data leak dressed up as a retry.
    await expect(
      service.placeOrder(placeArgs(addressId, intent, { userId: OTHER_USER }))
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('re-quotes rather than trusting a client total', async () => {
    const { service, repository, addressId, intent } = await build();
    await service.placeOrder(placeArgs(addressId, intent));

    const created = repository.createCalls[0]!;
    const linesTotal = created.lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);

    expect(created.grossAmountPaise).toBeGreaterThan(0);
    expect(created.totalAmountPaise).toBe(
      linesTotal -
        created.couponDiscountPaise +
        created.deliveryFeePaise +
        created.packagingFeePaise +
        created.serviceFeePaise
    );
  });

  it('FREEZES the address onto the order', async () => {
    const { service, repository, customer, addressId, intent } = await build();
    await service.placeOrder(placeArgs(addressId, intent));

    const snapshot = repository.createCalls[0]!.deliveryAddressSnapshot;
    expect(snapshot).toMatchObject({ line1: '1 Test Street', pincode: SERVICEABLE_PINCODE });

    // Editing the address afterwards must not rewrite history.
    await customer.updateAddress(USER, addressId, {
      addressType: 'HOME',
      recipientName: 'Order Tester',
      recipientPhone: '+919876543210',
      line1: '999 Moved Away',
      city: 'Indore',
      state: 'Madhya Pradesh',
      pincode: SERVICEABLE_PINCODE,
    });
    expect(repository.createCalls[0]!.deliveryAddressSnapshot).toMatchObject({
      line1: '1 Test Street',
    });
  });

  it('FREEZES the product name and price onto every line', async () => {
    const { service, repository, addressId, intent } = await build();
    await service.placeOrder(placeArgs(addressId, intent));

    for (const line of repository.createCalls[0]!.lines) {
      expect(line.productNameSnapshot).not.toBe('');
      expect(line.unitPricePaise).toBeGreaterThan(0);
      expect(line.lineTotalPaise).toBe(line.unitPricePaise * line.quantity);
    }
  });

  it('writes ZERO tax while D-14 is blocked', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    // No rate is inferred from category or price. A guessed GST rate on a real invoice is a
    // compliance problem, not a rounding problem.
    expect(order.taxAmountPaise).toBe(0);
    expect(order.taxableAmountPaise).toBe(0);
  });

  it('enforces the checkout blockers instead of trusting the customer saw them', async () => {
    const { service, customer, intent } = await build();
    const unserviceable = await customer.createAddress(USER, {
      addressType: 'HOME',
      recipientName: 'Order Tester',
      recipientPhone: '+919876543210',
      line1: '1 Far Away',
      city: 'Delhi',
      state: 'Delhi',
      pincode: UNSERVICEABLE_PINCODE,
    });

    await expect(service.placeOrder(placeArgs(unserviceable.id, intent))).rejects.toThrow();
  });

  it('refuses an empty cart', async () => {
    const { service, addressId } = await build();
    const empty: CartIntent = { storeId: null, lines: [], couponCode: null };

    await expect(service.placeOrder(placeArgs(addressId, empty))).rejects.toThrow();
  });

  it('refuses when the customer has no address at all', async () => {
    const { service, intent } = await build();

    // A null addressId falls back to the customer's default address, so the only way to
    // genuinely have none is a customer who never saved one.
    await expect(
      service.placeOrder(placeArgs(null, intent, { userId: OTHER_USER }))
    ).rejects.toThrow();
  });

  it('reports INSUFFICIENT_STOCK with the real available quantity', async () => {
    const { service, repository, addressId, intent } = await build();
    repository.shortfalls = [{ variantId: 'variant-x', requested: 4, available: 1 }];

    // The available quantity is what lets the UI offer "reduce to 1" instead of a dead end.
    await expect(service.placeOrder(placeArgs(addressId, intent))).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { availableQuantity: 1, requestedQuantity: 4 },
    });
  });

  it('records the source and the customer note', async () => {
    const { service, repository, addressId, intent } = await build();
    await service.placeOrder(
      placeArgs(addressId, intent, { source: 'PWA', customerNote: 'Ring the bell twice' })
    );

    expect(repository.createCalls[0]).toMatchObject({
      source: 'PWA',
      customerNote: 'Ring the bell twice',
    });
  });

  it('defaults the source to WEB', async () => {
    const { service, repository, addressId, intent } = await build();
    await service.placeOrder(placeArgs(addressId, intent));

    expect(repository.createCalls[0]!.source).toBe('WEB');
  });
});

describe('reads are scoped to the owner', () => {
  it('returns an order to the customer who placed it', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    const detail = await service.getForUser(USER, order.id);
    expect(detail.order.id).toBe(order.id);
    expect(detail.lines.length).toBeGreaterThan(0);
    expect(detail.timeline[0]?.fromStatus).toBeNull();
  });

  it('answers NOT_FOUND for another customer, not FORBIDDEN', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    // A 403 would confirm the order exists. Another customer's order and a nonexistent one
    // are deliberately the same answer.
    await expect(service.getForUser(OTHER_USER, order.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('answers NOT_FOUND for an order id that never existed', async () => {
    const { service } = await build();
    await expect(service.getForUser(USER, 'order-nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('lists only the caller\u2019s own orders', async () => {
    const { service, repository, addressId, intent } = await build();
    await service.placeOrder(placeArgs(addressId, intent, { idempotencyKey: 'mine' }));
    await service.placeOrder(
      placeArgs(addressId, intent, { idempotencyKey: 'theirs', userId: OTHER_USER })
    ).catch(() => undefined);

    const page = await service.listForUser(USER, { limit: 10 });
    expect(page.items.every((item) => repository.orders.get(item.id)?.order.userId === USER)).toBe(
      true
    );
  });
});

describe('transition', () => {
  it('moves an order through a legal transition and records the effects', async () => {
    const { service, repository, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    const moved = await service.transition({
      orderId: order.id,
      to: 'ACCEPTED',
      actor: 'VENDOR',
      actorUserId: 'vendor-1',
    });

    expect(moved.status).toBe('ACCEPTED');
    // The effects come from the state machine, not from the caller — that is what stops a
    // path from skipping a stock movement.
    expect(repository.transitions[0]?.effects).toEqual(
      requireTransition('CONFIRMED', 'ACCEPTED', 'VENDOR').effects
    );
  });

  it('refuses an illegal transition', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    await expect(
      service.transition({ orderId: order.id, to: 'DELIVERED', actor: 'DRIVER', actorUserId: null })
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
  });

  it('refuses an actor the transition does not permit', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    // A customer must not be able to accept their own order on the vendor's behalf.
    await expect(
      service.transition({ orderId: order.id, to: 'ACCEPTED', actor: 'CUSTOMER', actorUserId: USER })
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
  });

  it('demands a reason when the transition requires one', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    await expect(
      service.transition({
        orderId: order.id,
        to: 'CANCELLED',
        actor: 'VENDOR',
        actorUserId: 'vendor-1',
        reason: '   ',
      })
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATED' });
  });

  it('trims the reason it stores', async () => {
    const { service, repository, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    await service.transition({
      orderId: order.id,
      to: 'CANCELLED',
      actor: 'VENDOR',
      actorUserId: 'vendor-1',
      reason: '  out of stock  ',
    });

    expect(repository.transitions.at(-1)?.reason).toBe('out of stock');
  });

  it('answers NOT_FOUND for an unknown order', async () => {
    const { service } = await build();
    await expect(
      service.transition({ orderId: 'order-nope', to: 'ACCEPTED', actor: 'VENDOR', actorUserId: null })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('appends to the timeline on every move, with no gaps', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    await service.transition({ orderId: order.id, to: 'ACCEPTED', actor: 'VENDOR', actorUserId: null });
    await service.transition({ orderId: order.id, to: 'PREPARING', actor: 'VENDOR', actorUserId: null });

    const detail = await service.getForUser(USER, order.id);
    expect(detail.timeline.map((e) => e.toStatus)).toEqual(['CONFIRMED', 'ACCEPTED', 'PREPARING']);
    // Each row's from-status must be the previous row's to-status, or the history has a hole.
    expect(detail.timeline[1]?.fromStatus).toBe('CONFIRMED');
    expect(detail.timeline[2]?.fromStatus).toBe('ACCEPTED');
  });
});

describe('cancel', () => {
  it('cancels a CONFIRMED order for the customer with a full refund', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    const { order: cancelled, decision } = await service.cancel({
      orderId: order.id,
      actor: 'CUSTOMER',
      actorUserId: USER,
      reason: 'Changed my mind',
      restrictToUserId: USER,
    });

    expect(cancelled.status).toBe('CANCELLED');
    expect(decision.refundPercent).toBe(100);
    expect(decision.restock).toBe(true);
    expect(cancelled.cancellationReason).toBe('Changed my mind');
  });

  it('releases the stock it reserved', async () => {
    const { service, repository, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    await service.cancel({
      orderId: order.id,
      actor: 'CUSTOMER',
      actorUserId: USER,
      reason: 'Changed my mind',
      restrictToUserId: USER,
    });

    // Without RELEASE_STOCK the units stay reserved forever and availability silently rots.
    expect(repository.transitions.at(-1)?.effects).toContain('RELEASE_STOCK');
  });

  it('refuses once the vendor has accepted, and says why', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));
    await service.transition({ orderId: order.id, to: 'ACCEPTED', actor: 'VENDOR', actorUserId: null });

    await expect(
      service.cancel({
        orderId: order.id,
        actor: 'CUSTOMER',
        actorUserId: USER,
        reason: 'Changed my mind',
        restrictToUserId: USER,
      })
    ).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATED',
      details: { reason: 'NO_POLICY' },
    });
  });

  it('does not move the order when the policy refuses', async () => {
    const { service, repository, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));
    await service.transition({ orderId: order.id, to: 'ACCEPTED', actor: 'VENDOR', actorUserId: null });

    const before = repository.transitions.length;
    await service
      .cancel({
        orderId: order.id,
        actor: 'CUSTOMER',
        actorUserId: USER,
        reason: 'Changed my mind',
        restrictToUserId: USER,
      })
      .catch(() => undefined);

    expect(repository.transitions).toHaveLength(before);
    expect(repository.orders.get(order.id)?.order.status).toBe('ACCEPTED');
  });

  it('will not let one customer cancel another\u2019s order', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    await expect(
      service.cancel({
        orderId: order.id,
        actor: 'CUSTOMER',
        actorUserId: OTHER_USER,
        reason: 'Not mine',
        restrictToUserId: OTHER_USER,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets an admin cancel without an ownership restriction', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));
    await service.transition({ orderId: order.id, to: 'ACCEPTED', actor: 'VENDOR', actorUserId: null });

    const { order: cancelled } = await service.cancel({
      orderId: order.id,
      actor: 'ADMIN',
      actorUserId: 'admin-1',
      reason: 'Store closed unexpectedly',
    });

    expect(cancelled.status).toBe('CANCELLED');
  });

  it('demands a reason from an admin', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    await expect(
      service.cancel({ orderId: order.id, actor: 'ADMIN', actorUserId: 'admin-1', reason: '  ' })
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATED' });
  });

  it('lets a customer abandon an unpaid order', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(
      placeArgs(addressId, intent, { paymentMethod: 'UPI' })
    );

    const { order: cancelled } = await service.cancel({
      orderId: order.id,
      actor: 'CUSTOMER',
      actorUserId: USER,
      reason: '',
      restrictToUserId: USER,
    });

    expect(cancelled.status).toBe('CANCELLED');
  });
});

describe('view helpers', () => {
  it('marks in-flight statuses active and finished ones not', async () => {
    const { service } = await build();

    for (const status of ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'] as const) {
      expect(service.isActive(status), status).toBe(true);
    }
    for (const status of ['DELIVERED', 'CANCELLED', 'REFUNDED'] as const) {
      expect(service.isActive(status), status).toBe(false);
    }
  });

  it('offers only the next actions the actor can actually perform', async () => {
    const { service } = await build();

    const vendor = service.nextActionsFor('CONFIRMED', 'VENDOR');
    expect(vendor).toContain('ACCEPTED');
    // Rendering a button that 409s on click is worse than not rendering it.
    expect(service.nextActionsFor('CONFIRMED', 'DRIVER')).not.toContain('ACCEPTED');
  });

  it('shows the cancel button only while cancellation would succeed', async () => {
    const { service, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    expect(service.canCustomerCancel(order)).toBe(true);

    const accepted = await service.transition({
      orderId: order.id,
      to: 'ACCEPTED',
      actor: 'VENDOR',
      actorUserId: null,
    });
    expect(service.canCustomerCancel(accepted)).toBe(false);
  });
});

describe('sweepExpiredPendingPayment', () => {
  it('cancels unpaid orders past the timeout', async () => {
    const { service, repository, addressId, intent } = await build();
    const { order } = await service.placeOrder(
      placeArgs(addressId, intent, { paymentMethod: 'UPI' })
    );

    // Backdate past any plausible timeout so the sweep genuinely selects it.
    const detail = repository.orders.get(order.id)!;
    const old = new Date(Date.now() - 24 * 60 * 60_000);
    repository.orders.set(order.id, { ...detail, order: { ...detail.order, createdAt: old } });

    const { released } = await service.sweepExpiredPendingPayment();

    expect(released).toBe(1);
    expect(repository.orders.get(order.id)?.order.status).toBe('CANCELLED');
    expect(repository.transitions.at(-1)?.effects).toContain('RELEASE_STOCK');
    expect(repository.transitions.at(-1)?.actor).toBe('SYSTEM');
  });

  it('leaves a fresh unpaid order alone', async () => {
    const { service, repository, addressId, intent } = await build();
    const { order } = await service.placeOrder(
      placeArgs(addressId, intent, { paymentMethod: 'UPI' })
    );

    const { released } = await service.sweepExpiredPendingPayment();

    expect(released).toBe(0);
    expect(repository.orders.get(order.id)?.order.status).toBe('PENDING_PAYMENT');
  });

  it('never touches a paid or confirmed order', async () => {
    const { service, repository, addressId, intent } = await build();
    const { order } = await service.placeOrder(placeArgs(addressId, intent));

    const detail = repository.orders.get(order.id)!;
    repository.orders.set(order.id, {
      ...detail,
      order: { ...detail.order, createdAt: new Date(Date.now() - 24 * 60 * 60_000) },
    });

    await service.sweepExpiredPendingPayment();
    expect(repository.orders.get(order.id)?.order.status).toBe('CONFIRMED');
  });

  it('keeps sweeping after one order fails', async () => {
    const { service, repository, addressId, intent } = await build();
    const first = await service.placeOrder(
      placeArgs(addressId, intent, { paymentMethod: 'UPI', idempotencyKey: 'sweep-1' })
    );
    const second = await service.placeOrder(
      placeArgs(addressId, intent, { paymentMethod: 'UPI', idempotencyKey: 'sweep-2' })
    );

    for (const id of [first.order.id, second.order.id]) {
      const detail = repository.orders.get(id)!;
      repository.orders.set(id, {
        ...detail,
        order: { ...detail.order, createdAt: new Date(Date.now() - 24 * 60 * 60_000) },
      });
    }
    // Most likely cause in production: the order moved between the read and the write, which
    // is the benign case. One stuck order must not stop the queue.
    repository.failTransitionsFor.add(first.order.id);

    const { released } = await service.sweepExpiredPendingPayment();

    expect(released).toBe(1);
    expect(repository.orders.get(second.order.id)?.order.status).toBe('CANCELLED');
  });

  it('honours the limit it is given', async () => {
    const { service, repository, addressId, intent } = await build();

    for (const key of ['a', 'b', 'c']) {
      const placed = await service.placeOrder(
        placeArgs(addressId, intent, { paymentMethod: 'UPI', idempotencyKey: `limit-${key}` })
      );
      const detail = repository.orders.get(placed.order.id)!;
      repository.orders.set(placed.order.id, {
        ...detail,
        order: { ...detail.order, createdAt: new Date(Date.now() - 24 * 60 * 60_000) },
      });
    }

    const { released } = await service.sweepExpiredPendingPayment(2);
    expect(released).toBe(2);
  });
});
