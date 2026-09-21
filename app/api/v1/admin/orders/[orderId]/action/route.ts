import { z } from 'zod';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { updateAdminOrderNote } from '@/modules/admin-orders';
import { getOrderService } from '@/modules/order';

const orderStatuses = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'PAYMENT_FAILED',
  'REFUNDED',
  'RETURNED',
  'FAILED_DELIVERY',
] as const;

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('transition'),
    to: z.enum(orderStatuses),
    reason: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal('cancel'),
    reason: z.string().trim().min(3).max(1000),
  }),
  z.object({
    action: z.literal('note'),
    note: z.string().trim().max(4000).nullable(),
  }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const requestId = requestIdFrom(request);

  try {
    const { orderId } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError(
        'Check the order action and try again.',
        parsed.error.flatten().fieldErrors
      );
    }

    if (parsed.data.action === 'note') {
      const actor = await requireCurrentPermission('order:note');
      await updateAdminOrderNote(orderId, parsed.data.note || null, actor.userId);
      return apiSuccess({ orderId, noteSaved: true }, { meta: { requestId } });
    }

    const service = await getOrderService();

    if (parsed.data.action === 'cancel') {
      const actor = await requireCurrentPermission('order:cancel');
      const result = await service.cancel({
        orderId,
        actor: 'ADMIN',
        actorUserId: actor.userId,
        reason: parsed.data.reason,
      });
      return apiSuccess(
        {
          orderId,
          status: result.order.status,
          refundAmountPaise: result.decision.refundAmountPaise,
        },
        { meta: { requestId } }
      );
    }

    const actor = await requireCurrentPermission('order:update_status');
    const order = await service.transition({
      orderId,
      to: parsed.data.to,
      actor: 'ADMIN',
      actorUserId: actor.userId,
      reason: parsed.data.reason,
    });

    return apiSuccess({ orderId, status: order.status }, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
