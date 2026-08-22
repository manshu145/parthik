import { handleVendorOrderAction } from '@/lib/http/vendor-order-action';

/**
 * POST /api/v1/vendor/orders/:orderId/preparing — the vendor has started picking the order.
 *
 * Its only real job is telling the customer, whose tracker moves from "accepted" to "being
 * prepared" — the difference between a wait that feels stalled and one that feels progressing.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return handleVendorOrderAction(request, context, { to: 'PREPARING' });
}
