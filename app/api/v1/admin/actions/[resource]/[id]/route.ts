import { z } from 'zod';
import { requireCurrentPermission, requireSurface } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import type { PermissionKey } from '@/modules/identity';
import {
  adjustInventory,
  assignDelivery,
  replyToSupportTicket,
  updateCustomerStatus,
  updateDriverStatus,
  updatePayoutStatus,
  updateProductStatus,
  updateSupportTicket,
  updateVendorStatus,
} from '@/modules/admin-actions';

const resourceSchema = z.enum([
  'vendor',
  'driver',
  'product',
  'customer',
  'inventory',
  'delivery',
  'support',
  'payout',
]);

const actionSchema = z.object({
  action: z.string().trim().min(1).max(40),
  reason: z.string().trim().max(1000).optional(),
  delta: z.number().int().min(-1000000).max(1000000).optional(),
  driverId: z.string().uuid().optional(),
  message: z.string().trim().max(5000).optional(),
  internal: z.boolean().optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  resolutionNote: z.string().trim().max(5000).nullable().optional(),
  referenceNumber: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
});

function permissionFor(resource: z.infer<typeof resourceSchema>, action: string): PermissionKey {
  if (resource === 'vendor') {
    return action === 'approve' || action === 'reject' ? 'vendor:approve' : 'vendor:suspend';
  }
  if (resource === 'driver') {
    return action === 'approve' || action === 'reject' ? 'driver:approve' : 'driver:suspend';
  }
  if (resource === 'product') {
    return action === 'approve' || action === 'reject' ? 'product:approve' : 'product:manage';
  }
  if (resource === 'customer') return 'customer:suspend';
  if (resource === 'inventory') return 'inventory:manage';
  if (resource === 'delivery') return 'delivery:assign';
  if (resource === 'support') return action === 'reply' ? 'ticket:reply' : 'ticket:manage';
  return 'payout:manage';
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  const requestId = requestIdFrom(request);
  try {
    const routeParams = await params;
    const resourceResult = resourceSchema.safeParse(routeParams.resource);
    if (!resourceResult.success) throw new ValidationError('Unknown admin resource.');

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const parsed = actionSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError('Invalid admin action payload.');

    const { id } = routeParams;
    const input = parsed.data;
    await requireSurface('admin');
    const actor = await requireCurrentPermission(permissionFor(resourceResult.data, input.action));

    let result: unknown;
    if (resourceResult.data === 'vendor') {
      const action = z.enum(['approve', 'reject', 'suspend', 'reactivate']).parse(input.action);
      result = await updateVendorStatus(id, action, actor.userId, input.reason);
    } else if (resourceResult.data === 'driver') {
      const action = z.enum(['approve', 'reject', 'suspend', 'reactivate']).parse(input.action);
      result = await updateDriverStatus(id, action, actor.userId, input.reason);
    } else if (resourceResult.data === 'product') {
      const action = z.enum(['approve', 'reject', 'deactivate', 'reactivate']).parse(input.action);
      result = await updateProductStatus(id, action, actor.userId, input.reason);
    } else if (resourceResult.data === 'customer') {
      const action = z.enum(['suspend', 'ban', 'activate']).parse(input.action);
      result = await updateCustomerStatus(id, action, actor.userId, input.reason);
    } else if (resourceResult.data === 'inventory') {
      if (input.action !== 'adjust' || input.delta === undefined) {
        throw new ValidationError('Inventory adjustment requires action=adjust and delta.');
      }
      result = await adjustInventory(id, input.delta, actor.userId, input.reason ?? '');
    } else if (resourceResult.data === 'delivery') {
      if (input.action !== 'assign' || !input.driverId) {
        throw new ValidationError('Delivery assignment requires a driver.');
      }
      result = await assignDelivery(id, input.driverId, actor.userId, input.reason);
    } else if (resourceResult.data === 'support') {
      if (input.action === 'reply') {
        result = await replyToSupportTicket(
          id,
          actor.userId,
          input.message ?? '',
          input.internal ?? false
        );
      } else if (input.action === 'update') {
        result = await updateSupportTicket(id, actor.userId, {
          status: input.status,
          priority: input.priority,
          assignedToUserId: input.assignedToUserId,
          resolutionNote: input.resolutionNote,
        });
      } else {
        throw new ValidationError('Unknown support action.');
      }
    } else {
      const action = z.enum(['approve', 'mark_paid', 'fail']).parse(input.action);
      result = await updatePayoutStatus(id, action, actor.userId, {
        referenceNumber: input.referenceNumber,
        notes: input.notes,
      });
    }

    return apiSuccess(result, { meta: { requestId } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError(new ValidationError('Invalid admin action.'), { requestId });
    }
    return apiError(error, { requestId });
  }
}
