import { requireCurrentActor } from '@/lib/auth/current-actor';
import { AuthorizationError } from '@/lib/errors';
import {
  requirePermission,
  vendorScopeIdsFor,
  type Actor,
  type PermissionKey,
} from '@/modules/identity';

/**
 * Resolves the vendor a request is acting for, and authorises against it.
 *
 * WHY THIS EXISTS RATHER THAN A `vendorId` IN THE BODY: a client-supplied tenant id is a tenant
 * boundary the client can move. Every vendor endpoint therefore derives the vendor from the
 * SESSION's role grants (docs/API_SPEC.md §7: "a `vendorId` in a request body is never trusted").
 *
 * A vendor-scoped grant carries the vendor id, so a VENDOR_OWNER for vendor A cannot pass
 * `requirePermission(..., { vendorId: B })` — `grantCoversScope` rejects it. That is the whole
 * containment mechanism, and it only works if the scope is actually passed, which is why this
 * helper exists instead of each route remembering to.
 */
export async function requireVendorActor(
  permission: PermissionKey
): Promise<{ actor: Actor; vendorId: string }> {
  const actor = await requireCurrentActor();
  const vendorIds = vendorScopeIdsFor(actor);

  /**
   * Exactly one vendor, for now.
   *
   * A user with grants for two vendors would need to say which one they are acting as, and
   * guessing would be worse than refusing. D-32 (multi-store) is unanswered, so this refuses
   * loudly rather than inventing a selection rule that would have to be undone.
   */
  const vendorId = vendorIds[0];

  if (!vendorId) {
    throw new AuthorizationError('PERMISSION_REQUIRED', 'This account is not linked to a vendor.', {
      context: { reason: 'no vendor-scoped grant' },
    });
  }

  // Scoped, so the grant has to cover THIS vendor rather than merely carrying the permission.
  requirePermission(actor, permission, { vendorId });

  return { actor, vendorId };
}
