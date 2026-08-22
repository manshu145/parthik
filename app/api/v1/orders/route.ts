import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { clearCart, loadCart } from '@/lib/shell/cart-session';
import { getOrderService, orderListQuerySchema, placeOrderBodySchema } from '@/modules/order';

/**
 * POST /api/v1/orders — place an order (docs/API_SPEC.md §7, master spec §12).
 * GET  /api/v1/orders — the customer's order history.
 *
 * The POST body carries an idempotency key, an address choice and a payment method. Nothing
 * monetary: totals, fees and the discount are recomputed from the cart and the catalogue
 * inside the creating transaction.
 *
 * A repeated key returns the ORIGINAL order with 200 rather than creating a second one, so a
 * double-click or a retried request after a timeout is safe.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    // No guest checkout in V1: an order needs an owner for tracking, support and refunds.
    const actor = await requireCurrentActor();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A JSON body is required.');
    }

    const parsed = placeOrderBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid order request.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const [{ intent, owner }, service] = await Promise.all([loadCart(), getOrderService()]);

    const result = await service.placeOrder({
      userId: actor.userId,
      locale,
      intent,
      addressId: parsed.data.addressId ?? null,
      paymentMethod: parsed.data.paymentMethod,
      idempotencyKey: parsed.data.idempotencyKey,
      customerNote: parsed.data.customerNote ?? null,
      source: 'WEB',
    });

    const response = apiSuccess(
      {
        order: {
          id: result.order.id,
          orderNumber: result.order.orderNumber,
          status: result.order.status,
          totalAmountPaise: result.order.totalAmountPaise,
          paymentMethod: result.order.paymentMethod,
          paymentStatus: result.order.paymentStatus,
          isCod: result.order.isCod,
          codAmountPaise: result.order.codAmountPaise,
          estimatedDeliveryAt: result.order.estimatedDeliveryAt,
        },
        /**
         * Prepaid orders need a payment intent next; COD orders are already CONFIRMED.
         * Reported explicitly so the client does not have to infer the next step from the
         * status enum.
         */
        requiresPayment: !result.order.isCod,
        wasReplay: result.wasReplay,
      },
      // 200 on a replay, 201 on a genuine creation — a retry did not create anything.
      { status: result.wasReplay ? 200 : 201, meta: { requestId, locale } }
    );

    /**
     * The cart is emptied only on a REAL creation.
     *
     * Not on a replay: the cart was already cleared by the original request, and clearing
     * again would be a pointless write. Done after the order exists, so a failed creation
     * leaves the customer's cart intact — losing both the order and the cart would be the
     * worst outcome.
     */
    if (!result.wasReplay) {
      await clearCart(response, owner);
    }

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    const actor = await requireCurrentActor();

    const url = new URL(request.url);
    const parsed = orderListQuerySchema.safeParse({
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
    });

    if (!parsed.success) throw new ValidationError('Invalid list request.');

    const service = await getOrderService();
    const page = await service.listForUser(actor.userId, {
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
    });

    const response = apiSuccess(page, {
      meta: { requestId, locale, hasMore: page.nextCursor !== null },
    });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
