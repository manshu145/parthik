import type { Locale } from '@/i18n/routing';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { CartIntent } from '@/modules/cart';
import type { CheckoutService } from '@/modules/checkout';
import type { CheckoutQuote, PaymentMethod } from '@/modules/checkout';
import { getSetting } from '@/modules/settings';
import {
  canCancel,
  evaluateCancellation,
  type CancellationActor,
  type CancellationDecision,
} from './cancellation.policy';
import type {
  OrderDetail,
  OrderListItem,
  OrderRecord,
  OrderRepository,
} from './order.repository.types';
import {
  ACTIVE_STATUSES,
  allowedTransitionsFor,
  requireTransition,
  type OrderStatus,
  type TransitionActor,
} from './order.state';

/**
 * Order service.
 *
 * Owns the three things that must not live anywhere else:
 *
 *   IDEMPOTENCY   The same key returns the same order. A double-click, a retried fetch or a
 *                 flaky network must never create two orders.
 *   RE-VERIFICATION  The quote is recomputed here, immediately before creation. It was
 *                 already verified when the customer opened checkout, but that was a
 *                 different moment — and the reservation itself happens under a row lock
 *                 inside the repository, which is the only place the race can actually be
 *                 settled.
 *   TRANSITIONS   Every status change goes through the state machine and the cancellation
 *                 policy. Nothing writes `orders.status` directly.
 */

export interface OrderServiceDeps {
  repository: OrderRepository;
  checkout: CheckoutService;
}

export interface PlaceOrderInput {
  userId: string;
  locale: Locale;
  intent: CartIntent;
  addressId: string | null;
  paymentMethod: PaymentMethod;
  /** Supplied by the client so a retry is recognisable (master spec §12). */
  idempotencyKey: string;
  customerNote?: string | null;
  source?: 'WEB' | 'PWA' | 'ADMIN';
}

export interface PlaceOrderResult {
  order: OrderRecord;
  /** True when an existing order was returned for a repeated key. */
  wasReplay: boolean;
}

export class OrderService {
  constructor(private readonly deps: OrderServiceDeps) {}

  /**
   * Places an order.
   *
   * The ORDER OF OPERATIONS is the design:
   *   1. idempotency replay — before any work, so a retry is cheap and safe
   *   2. re-quote — because the checkout quote is already stale
   *   3. assert placeable — the same blockers the customer saw, enforced
   *   4. create — one transaction, stock reserved under a row lock
   */
  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    // ---- 1. Idempotency ----
    //
    // Keyed on the order table's own unique index rather than a separate ledger, so the
    // guarantee is the same one the database enforces. A second request with the same key
    // returns the first order instead of creating another.
    const existing = await this.deps.repository.findByIdempotencyKey(input.idempotencyKey);

    if (existing) {
      if (existing.userId !== input.userId) {
        // Someone else's key. Refusing rather than returning it, because returning another
        // customer's order would be a data leak dressed as a retry.
        throw new ConflictError('That request could not be processed.');
      }

      logger.info('Order creation replayed from idempotency key', { orderId: existing.id });
      return { order: existing, wasReplay: true };
    }

    // ---- 2. Re-quote ----
    const quote = await this.deps.checkout.quote({
      intent: input.intent,
      locale: input.locale,
      userId: input.userId,
      addressId: input.addressId,
      paymentMethod: input.paymentMethod,
    });

    // ---- 3. Enforce the blockers ----
    //
    // Throws the first blocker as a typed error. The customer has already seen and acted on
    // this list, so anything left is genuinely exceptional — usually something that changed
    // in the seconds since.
    this.deps.checkout.assertPlaceable(quote);

    const address = quote.address;
    const store = quote.cart.storeId;

    if (!address || !store) {
      throw new BusinessRuleError('BUSINESS_RULE_VIOLATED', 'Your order is missing details.');
    }

    const vendorId = quote.cart.lines[0]?.vendorId;
    if (!vendorId) {
      throw new BusinessRuleError('CART_EMPTY', 'Your cart is empty.');
    }

    // ---- 4. Create ----
    const result = await this.deps.repository.create({
      userId: input.userId,
      storeId: store,
      vendorId,
      deliveryZoneId: quote.zoneId,

      /**
       * A FROZEN copy of the address, not a foreign key alone. The order must remain
       * readable and disputable even after the customer edits or deletes the address
       * (docs/DATABASE.md §6).
       */
      deliveryAddressSnapshot: {
        line1: address.line1,
        line2: address.line2,
        landmark: address.landmark,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        country: address.country,
        latitude: address.latitude,
        longitude: address.longitude,
        deliveryInstructions: address.deliveryInstructions,
        addressType: address.addressType,
        label: address.label,
      },
      contactName: address.recipientName,
      contactPhone: address.recipientPhone,

      lines: quote.cart.lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        productNameSnapshot: line.productName,
        variantLabelSnapshot: line.variantLabel,
        imageKeySnapshot: line.imageKey,
        unitLabelSnapshot: line.unitLabel,
        skuSnapshot: null,
        quantity: line.quantity,
        mrpPaise: line.mrpPaise,
        unitPricePaise: line.unitPricePaise,
        itemDiscountPaise: Math.max(0, (line.mrpPaise - line.unitPricePaise) * line.quantity),
        lineTotalPaise: line.lineTotalPaise,
      })),

      grossAmountPaise: quote.cart.totals.grossAmountPaise,
      itemDiscountPaise: quote.cart.totals.itemDiscountPaise,
      couponId: null,
      couponCodeSnapshot: quote.cart.coupon?.isApplied ? quote.cart.coupon.code : null,
      couponDiscountPaise: quote.cart.totals.couponDiscountPaise,
      deliveryFeePaise: quote.cart.totals.deliveryFeePaise,
      packagingFeePaise: quote.cart.totals.packagingFeePaise,
      serviceFeePaise: quote.cart.totals.serviceFeePaise,
      totalAmountPaise: quote.totalPaise,

      paymentMethod: input.paymentMethod,
      estimatedDeliveryAt: estimateDeliveryAt(quote),
      customerNote: input.customerNote ?? null,

      idempotencyKey: input.idempotencyKey,
      source: input.source ?? 'WEB',
    });

    if (!result.ok) {
      // Lost the race for the last unit. Reported with the real available quantity so the UI
      // can offer to reduce the line rather than just saying no.
      const [shortfall] = result.shortfalls;

      throw new BusinessRuleError(
        'INSUFFICIENT_STOCK',
        'An item in your cart sold out while you were checking out.',
        {
          details: {
            variantId: shortfall?.variantId,
            availableQuantity: shortfall?.available ?? 0,
            requestedQuantity: shortfall?.requested ?? 0,
          },
        }
      );
    }

    logger.info('Order placed', {
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      paymentMethod: input.paymentMethod,
      totalPaise: result.order.totalAmountPaise,
    });

    return { order: result.order, wasReplay: false };
  }

  async getForUser(userId: string, orderId: string): Promise<OrderDetail> {
    const detail = await this.deps.repository.findForUser(userId, orderId);
    // Another customer's order and a nonexistent one are the same answer.
    if (!detail) throw new NotFoundError('That order could not be found.');
    return detail;
  }

  async listForUser(
    userId: string,
    page: { limit: number; cursor?: string | undefined }
  ): Promise<{ items: OrderListItem[]; nextCursor: string | null }> {
    return this.deps.repository.listForUser(userId, page);
  }

  /**
   * The vendor's queue, scoped in the query.
   *
   * The caller passes the vendor id it already authorised against; this never derives it from a
   * request body, because a body-supplied vendorId is a tenant boundary a client could move.
   */
  async listForVendor(
    vendorId: string,
    page: { limit: number; cursor?: string | undefined; statuses?: readonly OrderStatus[] }
  ): Promise<{ items: OrderListItem[]; nextCursor: string | null }> {
    return this.deps.repository.listForVendor(vendorId, page);
  }

  /**
   * An order a VENDOR may see.
   *
   * Refuses with NOT_FOUND when the order belongs to another vendor, so a vendor cannot even
   * confirm that an order id exists outside their own tenant.
   */
  async getForVendor(vendorId: string, orderId: string): Promise<OrderDetail> {
    const detail = await this.deps.repository.findById(orderId);
    if (!detail || detail.order.vendorId !== vendorId) {
      throw new NotFoundError('That order could not be found.');
    }
    return detail;
  }

  /**
   * An order for an INTERNAL operation — dispatch, a webhook, an admin screen.
   *
   * Deliberately unscoped, and named so that is obvious at the call site. Every caller must have
   * authorised the actor already; using this where `getForUser` or `getForVendor` belongs would
   * hand one tenant another's order.
   */
  async getForOperations(orderId: string): Promise<OrderDetail> {
    const detail = await this.deps.repository.findById(orderId);
    if (!detail) throw new NotFoundError('That order could not be found.');
    return detail;
  }

  /**
   * Moves an order, validating the transition and recording it.
   *
   * The ONLY way `orders.status` changes. Every caller — vendor dashboard, driver app, admin
   * screen, payment webhook, cron sweep — comes through here, so the history can never have
   * a gap and no path can skip a required side effect.
   */
  async transition(input: {
    orderId: string;
    to: OrderStatus;
    actor: TransitionActor;
    actorUserId: string | null;
    reason?: string | null;
  }): Promise<OrderRecord> {
    const detail = await this.deps.repository.findById(input.orderId);
    if (!detail) throw new NotFoundError('That order could not be found.');

    // Throws StateTransitionError (409) for an illegal move or a forbidden actor.
    const rule = requireTransition(detail.order.status, input.to, input.actor);

    if (rule.requiresReason && !input.reason?.trim()) {
      throw new BusinessRuleError(
        'BUSINESS_RULE_VIOLATED',
        'A reason is required for this change.'
      );
    }

    return this.deps.repository.applyTransition({
      orderId: input.orderId,
      from: detail.order.status,
      to: input.to,
      actor: input.actor,
      actorUserId: input.actorUserId,
      reason: input.reason?.trim() ?? null,
      effects: rule.effects,
    });
  }

  /**
   * Cancels an order, applying the cancellation policy.
   *
   * TWO independent gates, and both matter. The state machine says whether the move is
   * structurally possible; the policy engine says whether the business permits it and what
   * refund is owed. An order can be structurally cancellable and commercially not — a
   * customer cancelling after the vendor started cooking, for instance.
   */
  async cancel(input: {
    orderId: string;
    actor: CancellationActor;
    actorUserId: string | null;
    reason: string;
    /** Customers may only cancel their OWN order. */
    restrictToUserId?: string | null;
  }): Promise<{ order: OrderRecord; decision: CancellationDecision }> {
    const detail = input.restrictToUserId
      ? await this.deps.repository.findForUser(input.restrictToUserId, input.orderId)
      : await this.deps.repository.findById(input.orderId);

    if (!detail) throw new NotFoundError('That order could not be found.');

    const decision = evaluateCancellation({
      actor: input.actor,
      status: detail.order.status,
      isCod: detail.order.isCod,
      placedAt: detail.order.placedAt ?? detail.order.createdAt,
      itemValuePaise:
        detail.order.grossAmountPaise -
        detail.order.itemDiscountPaise -
        detail.order.couponDiscountPaise,
      deliveryFeePaise: detail.order.deliveryFeePaise,
    });

    if (!decision.isAllowed) {
      throw new BusinessRuleError(
        'BUSINESS_RULE_VIOLATED',
        decision.reason === 'WINDOW_EXPIRED'
          ? 'The cancellation window for this order has passed.'
          : 'This order can no longer be cancelled. Please contact support.',
        { details: { reason: decision.reason ?? 'NOT_PERMITTED' } }
      );
    }

    if (decision.requiresReason && !input.reason.trim()) {
      throw new BusinessRuleError(
        'BUSINESS_RULE_VIOLATED',
        'Please tell us why you are cancelling.'
      );
    }

    const order = await this.transition({
      orderId: input.orderId,
      to: 'CANCELLED',
      actor:
        input.actor === 'CUSTOMER' ? 'CUSTOMER' : input.actor === 'VENDOR' ? 'VENDOR' : 'ADMIN',
      actorUserId: input.actorUserId,
      reason: input.reason,
    });

    logger.info('Order cancelled', {
      orderId: order.id,
      actor: input.actor,
      refundAmountPaise: decision.refundAmountPaise,
    });

    return { order, decision };
  }

  /** What this actor may do next, for rendering only buttons that will work. */
  nextActionsFor(status: OrderStatus, actor: TransitionActor): OrderStatus[] {
    return allowedTransitionsFor(status, actor).map((rule) => rule.to);
  }

  /** Whether the customer-facing tracker should poll quickly (D-22). */
  isActive(status: OrderStatus): boolean {
    return ACTIVE_STATUSES.includes(status);
  }

  canCustomerCancel(order: OrderRecord): boolean {
    return canCancel({
      actor: 'CUSTOMER',
      status: order.status,
      isCod: order.isCod,
      placedAt: order.placedAt ?? order.createdAt,
      itemValuePaise: order.grossAmountPaise,
      deliveryFeePaise: order.deliveryFeePaise,
    });
  }

  /**
   * Releases stock held by orders that never got paid (D-16 rule 5).
   *
   * Without this, an abandoned checkout holds inventory forever and silently strangles
   * availability — the kind of fault that looks like "we keep going out of stock" rather than
   * a bug.
   */
  async sweepExpiredPendingPayment(limit = 50): Promise<{ released: number }> {
    const timeoutMinutes = await getSetting('order.payment_timeout_minutes');
    const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);

    const expired = await this.deps.repository.listExpiredPendingPayment(cutoff, limit);
    let released = 0;

    for (const order of expired) {
      try {
        await this.transition({
          orderId: order.id,
          to: 'CANCELLED',
          actor: 'SYSTEM',
          actorUserId: null,
          reason: `Unpaid for more than ${timeoutMinutes} minutes`,
        });
        released += 1;
      } catch (error) {
        // One order that cannot be swept must not stop the rest — most likely it moved
        // between the read and the write, which is exactly the benign case.
        logger.warn('Could not sweep an unpaid order', {
          orderId: order.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (released > 0) logger.info('Released stock from unpaid orders', { released });
    return { released };
  }
}

/** Turns the quote's ETA window into a concrete timestamp for the order. */
function estimateDeliveryAt(quote: CheckoutQuote): Date | null {
  if (quote.etaMaxMinutes === null) return null;
  // The upper bound, so the promise on the order is the one we are least likely to miss.
  return new Date(Date.now() + quote.etaMaxMinutes * 60_000);
}

export function createOrderService(deps: OrderServiceDeps): OrderService {
  return new OrderService(deps);
}
