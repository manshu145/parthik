import type { SurfaceKind } from '@/lib/http/route-access';
import {
  can,
  surfacesForRoles,
  type Actor,
  type PermissionKey,
  type ResourceScope,
} from '@/modules/identity';
import { getCurrentActor } from './current-actor';

/**
 * Page-level access decisions (master spec §25, docs/ROUTES.md §8).
 *
 * Returns a DECISION rather than throwing, because a page must render an outcome the
 * user can act on. Throwing sends the request to the generic error boundary, which says
 * "Something went wrong" and offers Retry — wrong on both counts for a permission
 * denial: nothing went wrong, and retrying can never succeed.
 *
 * Route handlers and services keep using the throwing `requirePermission`, because
 * there the correct answer is a 403 JSON envelope, not a rendered page.
 *
 * The two cases are kept separate deliberately. "Not signed in" is fixable by signing
 * in, so that state offers sign-in. "Signed in but not permitted" is not, so offering
 * sign-in there would be a dead end — and redirecting to a login page someone is
 * already past is the redirect loop §8 forbids.
 */

export type AccessDecision =
  | { status: 'ok'; actor: Actor }
  | { status: 'unauthenticated' }
  | { status: 'forbidden'; permission?: PermissionKey };

/** Decides whether the current actor holds a permission. */
export async function checkPagePermission(
  permission: PermissionKey,
  scope?: ResourceScope
): Promise<AccessDecision> {
  const actor = await getCurrentActor();

  if (!actor) return { status: 'unauthenticated' };
  if (!can(actor, permission, scope)) return { status: 'forbidden', permission };

  return { status: 'ok', actor };
}

/** Decides whether the current actor may reach a whole surface. */
export async function checkPageSurface(surface: SurfaceKind): Promise<AccessDecision> {
  const actor = await getCurrentActor();

  if (!actor) return { status: 'unauthenticated' };

  if (!surfacesForRoles(actor.roles.map((grant) => grant.roleKey)).has(surface)) {
    return { status: 'forbidden' };
  }

  return { status: 'ok', actor };
}
