import { handleDriverStep } from '@/lib/http/driver-delivery-step';

/**
 * POST /api/v1/driver/deliveries/:id/pickup — the driver has the order.\n *\n * Moves the ORDER to PICKED_UP in the same transaction, so the customer\u2019s tracker and the\n * delivery record can never disagree about whether the food has left the shop.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ deliveryId: string }> }) {
  return handleDriverStep(request, context, (service, input) => service.pickup(input));
}
