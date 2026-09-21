import { z } from 'zod';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { readSupportTicketForUser, replySupportTicketForUser } from '@/modules/support';

const replySchema = z.object({ message: z.string().trim().min(1).max(5000) });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentActor();
    const { ticketId } = await params;
    const detail = await readSupportTicketForUser(actor.userId, ticketId);
    return apiSuccess(detail, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const requestId = requestIdFrom(request);
  try {
    const actor = await requireCurrentActor();
    const { ticketId } = await params;
    const parsed = replySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError('Enter a support reply.', parsed.error.flatten().fieldErrors);
    }
    const reply = await replySupportTicketForUser(actor.userId, ticketId, parsed.data.message);
    return apiSuccess(reply, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
