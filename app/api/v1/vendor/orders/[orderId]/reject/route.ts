import { handleVendorOrderAction } from '@/lib/http/vendor-order-action';

/**
 * POST /api/v1/vendor/orders/:orderId/reject — the vendor cannot fulfil the order.
 *
 * Moves to CANCELLED, which the transition table pairs with RELEASE_STOCK, RELEASE_COUPON and
 * REFUND_DUE — so rejecting an order returns the stock and marks a refund owed without this
 * handler having to know any of that.
 *
 * A REASON IS REQUIRED. "Cancellations are up 8%" is unactionable; "up 8%, mostly out of stock"
 * points somewhere.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return handleVendorOrderAction(request, context, { to: 'CANCELLED', requiresReason: true });
}
