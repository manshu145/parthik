import { z } from 'zod';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { createSupportTicketForUser } from '@/modules/support';

const inputSchema = z.object({
  category: z.enum([
    'PAYMENT',
    'DELIVERY',
    'PRODUCT',
    'REFUND',
    'COUPON',
    'ACCOUNT',
    'VENDOR',
    'OTHER',
  ]),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().max(5000).optional(),
  orderId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentActor();
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        'Check the support ticket and try again.',
        parsed.error.flatten().fieldErrors
      );
    }

    const ticket = await createSupportTicketForUser(actor.userId, parsed.data);
    return apiSuccess(ticket, { status: 201, meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
