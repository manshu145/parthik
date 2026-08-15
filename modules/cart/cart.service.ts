import type { Locale } from '@/i18n/routing';
import { BusinessRuleError, NotFoundError } from '@/lib/errors';
import type { CatalogService } from '@/modules/catalog/catalog.service';
import type { PurchasableVariant } from '@/modules/catalog/catalog.repository.types';
import type { LocationService } from '@/modules/location/location.service';
import { CouponService, toAppliedDiscount, type CouponCartLine } from '@/modules/coupons';
import { calculatePricing, type AppliedDiscount, type PricingResult } from '@/modules/pricing';
import { estimateDeliveryWindow, type ZoneFeeConfig } from '@/modules/location/delivery-fee';
import {
  MAX_QUANTITY_PER_LINE,
  type CartCouponState,
  type CartIntent,
  type CartIssue,
  type CartLine,
  type CartLineIssue,
  type CartView,
} from './cart.types';

/**
 * Cart service.
 *
 * Owns the rules that must never live in a route handler or a component:
 *
 *   D-11  ONE STORE PER CART. Adding an item from another store is rejected with
 *         MIXED_VENDOR_CART rather than silently splitting or replacing the cart.
 *   PRICE Authority is the database, always. The cookie/`carts` row stores intent;
 *         prices are re-read on every view (docs/ARCHITECTURE.md §11.4).
 *   STOCK Validated at add, at view and again at order creation. Never cached.
 *
 * Totals come from the shared pricing engine, so cart, checkout and order creation
 * cannot disagree about what something costs.
 */

export interface CartServiceDeps {
  catalog: CatalogService;
  /** Optional: without a chosen location there is no zone, so no fee can be quoted. */
  location: LocationService;
  coupons: CouponService;
}

export interface CartContext {
  locale: Locale;
  /** Pincode of the chosen delivery location, when the customer has picked one. */
  pincode?: string | null;
  /**
   * Null for a guest. User-scoped coupon rules cannot be satisfied without it, so
   * a first-order coupon is refused rather than granted on trust.
   */
  userId?: string | null;
}

export class CartService {
  constructor(private readonly deps: CartServiceDeps) {}

  /**
   * Adds a variant, or increases an existing line.
   *
   * Returns the NEW INTENT for the caller to persist. The service never writes a
   * cookie or a row itself — that keeps it pure enough to unit test and lets the
   * same logic serve the cookie cart and the Postgres cart.
   */
  async addItem(
    intent: CartIntent,
    variantId: string,
    quantity: number,
    context: CartContext
  ): Promise<CartIntent> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BusinessRuleError(
        'QUANTITY_INVALID',
        'Quantity must be a whole number above zero.'
      );
    }

    const variant = await this.deps.catalog.getPurchasableVariant(variantId, context.locale);

    if (!variant) {
      throw new NotFoundError('That product could not be found.');
    }

    if (!variant.isPurchasable) {
      throw new BusinessRuleError('PRODUCT_UNAVAILABLE', 'That product is no longer available.');
    }

    if (!variant.storeAcceptingOrders) {
      throw new BusinessRuleError(
        'STORE_NOT_ACCEPTING_ORDERS',
        'This store is not accepting orders right now.'
      );
    }

    // D-11 — checked BEFORE any mutation, so a rejected add leaves the cart intact.
    if (intent.storeId !== null && intent.storeId !== variant.storeId) {
      throw new BusinessRuleError(
        'MIXED_VENDOR_CART',
        'Your cart has items from another store. Please place that order first, or clear your cart.'
      );
    }

    const existing = intent.lines.find((line) => line.variantId === variantId);
    const requested = (existing?.quantity ?? 0) + quantity;

    if (requested > MAX_QUANTITY_PER_LINE) {
      throw new BusinessRuleError(
        'QUANTITY_LIMIT_EXCEEDED',
        `You can order at most ${MAX_QUANTITY_PER_LINE} of one item.`
      );
    }

    // Stock is re-read here, not trusted from a cached listing.
    if (variant.trackInventory && requested > (variant.quantityAvailable ?? 0)) {
      throw new BusinessRuleError(
        'INSUFFICIENT_STOCK',
        `Only ${variant.quantityAvailable ?? 0} left in stock.`
      );
    }

    const lines = existing
      ? intent.lines.map((line) =>
          line.variantId === variantId ? { ...line, quantity: requested } : line
        )
      : [...intent.lines, { variantId, quantity }];

    return { ...intent, storeId: variant.storeId, lines };
  }

  /** Sets an exact quantity. Zero removes the line, which is what a stepper expects. */
  async setQuantity(
    intent: CartIntent,
    variantId: string,
    quantity: number,
    context: CartContext
  ): Promise<CartIntent> {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new BusinessRuleError('QUANTITY_INVALID', 'Quantity must be a whole number.');
    }

    if (quantity === 0) return this.removeItem(intent, variantId);

    if (!intent.lines.some((line) => line.variantId === variantId)) {
      throw new NotFoundError('That item is not in your cart.');
    }

    if (quantity > MAX_QUANTITY_PER_LINE) {
      throw new BusinessRuleError(
        'QUANTITY_LIMIT_EXCEEDED',
        `You can order at most ${MAX_QUANTITY_PER_LINE} of one item.`
      );
    }

    const variant = await this.deps.catalog.getPurchasableVariant(variantId, context.locale);

    if (variant?.trackInventory && quantity > (variant.quantityAvailable ?? 0)) {
      throw new BusinessRuleError(
        'INSUFFICIENT_STOCK',
        `Only ${variant.quantityAvailable ?? 0} left in stock.`
      );
    }

    return {
      ...intent,
      lines: intent.lines.map((line) =>
        line.variantId === variantId ? { ...line, quantity } : line
      ),
    };
  }

  removeItem(intent: CartIntent, variantId: string): CartIntent {
    const lines = intent.lines.filter((line) => line.variantId !== variantId);

    return {
      // Clearing the last line releases the store lock, so the next add is free to
      // pick any store.
      storeId: lines.length === 0 ? null : intent.storeId,
      lines,
      couponCode: lines.length === 0 ? null : intent.couponCode,
    };
  }

  clear(): CartIntent {
    return { storeId: null, lines: [], couponCode: null };
  }

  /**
   * Builds the full cart view: re-read prices, recomputed totals, and every issue
   * that would block checkout.
   *
   * This is the ONLY way a total reaches the UI.
   */
  async view(intent: CartIntent, context: CartContext): Promise<CartView> {
    const resolved = await Promise.all(
      intent.lines.map(async (line) => ({
        line,
        variant: await this.deps.catalog.getPurchasableVariant(line.variantId, context.locale),
      }))
    );

    const lines: CartLine[] = [];
    const pricingLines = [];
    const couponLineSeeds: Array<Omit<CouponCartLine, 'lineTotalPaise'>> = [];

    for (const { line, variant } of resolved) {
      // A variant that has vanished entirely cannot be shown or priced. Dropping it
      // is the only option, and the rest of the cart survives.
      if (!variant) continue;

      const issues: CartLineIssue[] = [];

      if (!variant.isPurchasable) issues.push({ code: 'PRODUCT_UNAVAILABLE' });

      const available = variant.quantityAvailable ?? 0;
      if (variant.trackInventory && line.quantity > available) {
        issues.push({ code: 'INSUFFICIENT_STOCK', availableQuantity: available });
      }

      if (line.quantity > MAX_QUANTITY_PER_LINE) {
        issues.push({ code: 'QUANTITY_LIMIT_EXCEEDED', maxQuantity: MAX_QUANTITY_PER_LINE });
      }

      lines.push({
        id: variant.variantId,
        variantId: variant.variantId,
        productId: variant.productId,
        categoryId: variant.categoryId,
        vendorId: variant.vendorId,
        productSlug: variant.productSlug,
        productName: variant.productName,
        variantLabel: variant.variantLabel,
        unitLabel: variant.unitLabel,
        imageKey: variant.imageKey,
        quantity: line.quantity,
        unitPricePaise: variant.pricePaise,
        mrpPaise: variant.mrpPaise,
        // Filled in from the pricing result below.
        lineTotalPaise: 0,
        couponDiscountPaise: 0,
        savingsPaise: 0,
        inStock: variant.inStock,
        quantityAvailable: variant.quantityAvailable,
        issues,
      });

      pricingLines.push({
        id: variant.variantId,
        variantId: variant.variantId,
        quantity: line.quantity,
        unitPricePaise: variant.pricePaise,
        mrpPaise: variant.mrpPaise,
        categoryId: variant.categoryId,
      });

      // Scoping facts for the coupon engine. `lineTotalPaise` is filled in from the
      // pricing result below, because that value is pricing's to define.
      couponLineSeeds.push({
        id: variant.variantId,
        variantId: variant.variantId,
        productId: variant.productId,
        categoryId: variant.categoryId,
        vendorId: variant.vendorId,
      });
    }

    // ---- Zone, for fees and ETA ----
    const serviceability = context.pincode
      ? await this.deps.location.checkServiceability(context.pincode)
      : null;

    const zone: ZoneFeeConfig | null =
      serviceability?.isServiceable && serviceability.baseDeliveryFeePaise !== null
        ? {
            baseDeliveryFeePaise: serviceability.baseDeliveryFeePaise,
            freeDeliveryThresholdPaise: serviceability.freeDeliveryThresholdPaise,
            minOrderPaise: serviceability.minOrderPaise ?? 0,
            perKmFeePaise: null,
            maxDeliveryFeePaise: null,
          }
        : null;

    // ---- Coupon ----
    //
    // Priced TWICE on purpose. The coupon engine needs each line's value after item
    // discounts, and that value is the pricing engine's to define — so pricing runs
    // once with no discount to establish line values, the coupon is evaluated
    // against them, then pricing runs again with the approved amount. Duplicating
    // "what is a line worth" here instead would be a second implementation of the
    // one rule the pricing engine exists to own. The engine is pure and cheap, so
    // the cost is arithmetic, not I/O.
    const provisional = calculatePricing({ lines: pricingLines, zone, discount: null });

    const { coupon, discount } = await this.resolveCoupon(intent.couponCode, {
      seeds: couponLineSeeds,
      provisional,
      zoneId: serviceability?.zone?.id ?? null,
      context,
    });

    const totals = discount
      ? calculatePricing({ lines: pricingLines, zone, discount })
      : provisional;

    // Attach the priced figures back to the display lines.
    const pricedById = new Map(totals.lines.map((priced) => [priced.id, priced]));
    for (const line of lines) {
      const priced = pricedById.get(line.id);
      if (!priced) continue;
      line.lineTotalPaise = priced.lineTotalPaise;
      line.couponDiscountPaise = priced.couponDiscountPaise;
      line.savingsPaise = priced.savingsPaise;
    }

    // ---- Cart-level issues ----
    const issues: CartIssue[] = [];

    if (lines.length === 0) {
      issues.push({ code: 'CART_EMPTY' });
    } else if (!context.pincode) {
      // Without a location there is no fee and no ETA, so checkout cannot proceed.
      issues.push({ code: 'LOCATION_REQUIRED' });
    } else if (!serviceability?.isServiceable) {
      issues.push({ code: 'NOT_SERVICEABLE', pincode: context.pincode });
    } else if (!totals.meetsMinimumOrder && totals.minOrderPaise !== null) {
      issues.push({
        code: 'MIN_ORDER_NOT_MET',
        minOrderPaise: totals.minOrderPaise,
        shortfallPaise: totals.minimumOrderGapPaise ?? 0,
      });
    }

    const window = estimateDeliveryWindow({
      zoneAvgMinutes: serviceability?.etaMinutes ?? null,
      routeDurationSeconds: null,
      storePrepMinutes: null,
    });

    return {
      lines,
      totals,
      storeId: intent.storeId,
      // The store name needs a store read; not required by any current surface, so
      // it is left null rather than fetched speculatively.
      storeName: null,
      coupon,
      issues,
      hasLineIssues: lines.some((line) => line.issues.length > 0),
      etaMinMinutes: window?.minMinutes ?? null,
      etaMaxMinutes: window?.maxMinutes ?? null,
    };
  }

  /**
   * Re-evaluates the cart's coupon against the CURRENT cart.
   *
   * Never throws. A coupon that has expired, been exhausted, or no longer clears the
   * minimum must not break the cart page — the cart renders with the discount
   * dropped and the reason reported, so the UI can explain itself. Throwing belongs
   * to `POST /api/v1/cart/coupon`, where the customer just asked a direct question.
   */
  private async resolveCoupon(
    code: string | null,
    input: {
      seeds: readonly Omit<CouponCartLine, 'lineTotalPaise'>[];
      provisional: PricingResult;
      zoneId: string | null;
      context: CartContext;
    }
  ): Promise<{ coupon: CartCouponState | null; discount: AppliedDiscount | null }> {
    if (!code) return { coupon: null, discount: null };

    const valueById = new Map(
      input.provisional.lines.map((line) => [line.id, line.lineTotalPaise as number])
    );

    const lines: CouponCartLine[] = input.seeds.map((seed) => ({
      ...seed,
      lineTotalPaise: valueById.get(seed.id) ?? 0,
    }));

    const evaluation = await this.deps.coupons.evaluate({
      code,
      lines,
      userId: input.context.userId ?? null,
      zoneId: input.zoneId,
      locale: input.context.locale,
    });

    if (!evaluation.isApplicable) {
      return {
        coupon: {
          code: evaluation.code,
          isApplied: false,
          reason: evaluation.reason,
          discountPaise: 0,
          waivesDeliveryFee: false,
        },
        discount: null,
      };
    }

    return {
      coupon: {
        code: evaluation.code,
        isApplied: true,
        discountPaise: evaluation.discountPaise,
        waivesDeliveryFee: evaluation.waivesDeliveryFee,
      },
      discount: toAppliedDiscount(evaluation),
    };
  }

  /**
   * Records a coupon on the cart intent AFTER verifying it applies.
   *
   * Throws the documented coupon error when it does not, so a rejected code is never
   * persisted — a cart carrying a code that can never work would show a refusal
   * banner on every page load.
   */
  async applyCoupon(intent: CartIntent, code: string, context: CartContext): Promise<CartIntent> {
    // Priced through the normal read path, so the coupon is judged against exactly
    // the cart the customer is looking at.
    const view = await this.view({ ...intent, couponCode: null }, context);

    if (view.lines.length === 0) {
      throw new BusinessRuleError('CART_EMPTY', 'Your cart is empty.');
    }

    const zoneId = context.pincode
      ? ((await this.deps.location.checkServiceability(context.pincode)).zone?.id ?? null)
      : null;

    // Throws on rejection — that is the point of `apply` over `evaluate`.
    await this.deps.coupons.apply({
      code,
      lines: view.lines.map((line) => ({
        id: line.id,
        variantId: line.variantId,
        productId: line.productId,
        categoryId: line.categoryId,
        vendorId: line.vendorId,
        lineTotalPaise: line.lineTotalPaise,
      })),
      userId: context.userId ?? null,
      zoneId,
      locale: context.locale,
    });

    return { ...intent, couponCode: CouponService.normaliseCode(code) };
  }

  removeCoupon(intent: CartIntent): CartIntent {
    return { ...intent, couponCode: null };
  }

  /** Convenience for the header badge: units in the cart, no pricing work. */
  countItems(intent: CartIntent): number {
    return intent.lines.reduce((sum, line) => sum + line.quantity, 0);
  }

  /**
   * Merges a guest cart into a user cart (API_SPEC §5).
   *
   * D-11 still applies: if the two carts belong to different stores, the USER cart
   * wins and the guest cart is discarded. Silently mixing stores would create a
   * cart that cannot be ordered, and quietly replacing a signed-in customer's cart
   * with an anonymous one is worse.
   */
  merge(userIntent: CartIntent, guestIntent: CartIntent): CartIntent {
    if (guestIntent.lines.length === 0) return userIntent;
    if (userIntent.lines.length === 0) return guestIntent;

    if (userIntent.storeId !== null && guestIntent.storeId !== userIntent.storeId) {
      return userIntent;
    }

    const merged = new Map(userIntent.lines.map((line) => [line.variantId, { ...line }]));

    for (const line of guestIntent.lines) {
      const existing = merged.get(line.variantId);

      merged.set(line.variantId, {
        variantId: line.variantId,
        // Quantities add, then clamp — the customer intended both.
        quantity: Math.min(MAX_QUANTITY_PER_LINE, (existing?.quantity ?? 0) + line.quantity),
      });
    }

    return {
      storeId: userIntent.storeId ?? guestIntent.storeId,
      lines: [...merged.values()],
      couponCode: userIntent.couponCode ?? guestIntent.couponCode,
    };
  }
}

export function createCartService(deps: CartServiceDeps): CartService {
  return new CartService(deps);
}

export type { PurchasableVariant };
