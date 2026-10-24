import { handleVendorOrderAction } from '@/lib/http/vendor-order-action';

/**
 * POST /api/v1/vendor/orders/:orderId/accept — the vendor takes the order (docs/API_SPEC.md §7).
 *
 * CONFIRMED -> ACCEPTED. The state machine allows this only for a VENDOR or an ADMIN, so a
 * customer cannot accept their own order and skip the queue.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return handleVendorOrderAction(request, context, { to: 'ACCEPTED' });
}
