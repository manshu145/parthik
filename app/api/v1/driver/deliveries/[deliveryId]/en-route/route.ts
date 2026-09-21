import { handleDriverStep } from '@/lib/http/driver-delivery-step';

/**
 * POST /api/v1/driver/deliveries/:id/en-route — on the way.\n *\n * This is the step that moves the order to OUT_FOR_DELIVERY, which is what makes the customer\u2019s\n * tracker start polling every eight seconds instead of every twenty (D-22).
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ deliveryId: string }> }) {
  return handleDriverStep(request, context, (service, input) => service.enRouteToCustomer(input));
}
