import { cookies } from 'next/headers';
import {
  can,
  getIdentityService,
  requireActor,
  requirePermission,
  type Actor,
  type PermissionKey,
  type ResourceScope,
} from '@/modules/identity';
import { SESSION_COOKIE_NAME } from './session-cookie';

/**
 * Reading the authenticated actor inside Server Components and Server Actions
 * (docs/SECURITY.md §5).
 *
 * THIS IS WHERE AUTHORIZATION ACTUALLY HAPPENS. Middleware decides which page shell
 * is reachable; this decides whether any data is returned. The distinction matters
 * because middleware on Cloudflare Workers cannot reach the database
 * (docs/ARCHITECTURE.md §4.2), so it can only ever make a routing guess from cookie
 * claims that may be minutes stale.
 *
 * Every function here re-reads the session from the DATABASE. That is a deliberate
 * cost: it is what makes revocation, bans and role changes take effect immediately
 * (D-10) rather than whenever a cookie happens to expire.
 */

async function readSessionCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

/**
 * The signed-in actor, or null.
 *
 * Never throws — an invalid or revoked session is reported as "not signed in" so a
 * public page can still render. Callers that REQUIRE a user use `requireCurrentActor`
 * instead, which is the loud version.
 */
export async function getCurrentActor(): Promise<Actor | null> {
  const cookieValue = await readSessionCookie();
  if (!cookieValue) return null;

  try {
    const service = await getIdentityService();
    const context = await service.resolveSession(cookieValue);
    return context?.actor ?? null;
  } catch {
    // Expired, revoked or suspended. The cookie cannot be cleared from a Server
    // Component (no response to write to), so it is cleared on the next route-handler
    // or middleware pass.
    return null;
  }
}

/** The actor, or throws AuthenticationError. */
export async function requireCurrentActor(): Promise<Actor> {
  return requireActor(await getCurrentActor());
}

/**
 * Asserts a permission and returns the actor.
 *
 * The single call every protected page and mutation should make:
 *
 *     const actor = await requireCurrentPermission('order:refund');
 *
 * Throws AuthenticationError (401) when unauthenticated and AuthorizationError (403)
 * when the permission is missing, both of which the error boundary maps to the
 * documented UX states.
 */
export async function requireCurrentPermission(
  permission: PermissionKey,
  scope?: ResourceScope
): Promise<Actor> {
  const actor = await getCurrentActor();
  return requirePermission(actor, permission, scope);
}

/**
 * Non-throwing permission check, for conditional UI.
 *
 * For HIDING controls, never for guarding data. A hidden button is a courtesy; the
 * server-side check on the action behind it is the actual control.
 */
export async function currentActorCan(
  permission: PermissionKey,
  scope?: ResourceScope
): Promise<boolean> {
  const actor = await getCurrentActor();
  if (!actor) return false;
  return can(actor, permission, scope);
}
