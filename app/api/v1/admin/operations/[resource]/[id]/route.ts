import { z } from 'zod';
import { requireSurface } from '@/lib/auth/current-actor';
import { AuthorizationError, ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { isPermissionKey, permissionsForRole, requirePermission } from '@/modules/identity';
import { updateAdminOperation } from '@/modules/admin-operations';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  const requestId = requestIdFrom(request);
  try {
    const { resource, id } = await params;
    if (!isPermissionKey(resource))
      throw new ValidationError('Unknown admin operation permission.');
    const actor = await requireSurface('admin');
    requirePermission(actor, resource);

    // Record the real global admin role that grants this permission. A permission
    // in a vendor/store-scoped grant must not be treated as an admin operation.
    const actingGrant = actor.roles.find(
      (grant) =>
        grant.scopeType === 'GLOBAL' &&
        (grant.roleKey === 'SUPER_ADMIN' ||
          (grant.permissions
            ? grant.permissions.includes(resource)
            : permissionsForRole(grant.roleKey).has(resource)))
    );
    if (!actingGrant) {
      throw new AuthorizationError(
        'FORBIDDEN',
        'An administrative role with this permission is required.'
      );
    }

    const parsed = z
      .object({ action: z.enum(['enable', 'disable', 'approve', 'reject']) })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError(
        'Choose a valid admin operation.',
        parsed.error.flatten().fieldErrors
      );
    }

    await updateAdminOperation(resource, id, parsed.data.action, actor.userId, actingGrant.roleKey);
    return apiSuccess({ id, action: parsed.data.action }, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
