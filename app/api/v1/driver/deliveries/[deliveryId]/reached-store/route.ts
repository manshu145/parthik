import { handleDriverStep } from '@/lib/http/driver-delivery-step';

/**
 * POST /api/v1/driver/deliveries/:id/reached-store — the driver is at the shop.\n *\n * Recorded for the store\u2019s benefit as much as the customer\u2019s: "the driver is here" is what stops\n * a bag sitting on a counter while everyone assumes somebody else has it.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ deliveryId: string }> }) {
  return handleDriverStep(request, context, (service, input) => service.reachedStore(input));
}
