import { getCurrentActor } from '@/lib/auth/current-actor';
import type { AccessDecision } from '@/lib/auth/page-guard';
import { can, vendorScopeIdsFor, type PermissionKey } from '@/modules/identity';

/**
 * Page-level access decision for a VENDOR-SCOPED screen.
 *
 * Returns the same `AccessDecision` shape as `checkPagePermission`, so a page renders
 * `<AccessDenied>` exactly as it would for any other denial. `checkPagePermission` cannot be
 * reused directly because it has no notion of a tenant.
 *
 * WHY A SEPARATE HELPER: a vendor's grant carries the vendor id, and `can(actor, permission)`
 * WITHOUT a scope returns true for any grant that merely holds the permission. Calling the
 * unscoped version on a vendor page would authorise a vendor for every tenant, and the mistake
 * would stay invisible until a second vendor existed. Passing the scope is not optional, so it
 * lives in one function rather than being remembered in every page.
 */
export async function checkVendorPage(
  permission: PermissionKey
): Promise<AccessDecision & { vendorId?: string }> {
  const actor = await getCurrentActor();

  if (!actor) return { status: 'unauthenticated' };

  const vendorId = vendorScopeIdsFor(actor)[0];

  // No vendor grant is reported as a permission failure rather than a special case: the copy and
  // the way out are the same, and inventing a third state would only add a screen nobody designed.
  if (!vendorId || !can(actor, permission, { vendorId })) {
    return { status: 'forbidden', permission };
  }

  return { status: 'ok', actor, vendorId };
}
