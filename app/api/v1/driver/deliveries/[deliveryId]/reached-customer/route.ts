import { handleDriverStep } from '@/lib/http/driver-delivery-step';

/**
 * POST /api/v1/driver/deliveries/:id/reached-customer — at the door.\n *\n * Deliberately does NOT move the order: arriving is not delivering. The handover still needs the\n * OTP (D-20), and treating arrival as completion is exactly the shortcut that check exists to\n * prevent.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ deliveryId: string }> }) {
  return handleDriverStep(request, context, (service, input) => service.reachedCustomer(input));
}
