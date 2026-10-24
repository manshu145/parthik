import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import type { SurfaceKind } from '@/lib/http/route-access';
import {
  permissionsForRoles,
  ROLE_SURFACES,
  type PermissionKey,
  type RoleKey,
} from './permissions';
import type { RoleGrant, UserRecord } from './identity.repository.types';

/**
 * The permission engine (docs/SECURITY.md §5).
 *
 * PERMISSION-BASED, NEVER ROLE-STRING-BASED. Call sites ask `can(actor, 'order:refund')`
 * and never `actor.role === 'ADMIN'`. The difference matters when a new admin tier
 * appears: with permissions, granting it access is a data change; with role strings
 * it is a hunt through every conditional in the codebase, and the ones that get
 * missed fail silently.
 *
 * Every decision here FAILS CLOSED (docs/ARCHITECTURE.md §2 principle 8): an unknown
 * role grants nothing, an unknown permission matches nothing, a missing scope denies.
 */

/**
 * The authenticated caller.
 *
 * Assembled by the identity service from the DATABASE on every request — never
 * from cookie claims, which are for routing only.
 */
export interface Actor {
  userId: string;
  sessionId: string;
  /**
   * Needed for privileged Identity Platform calls, which key on the FIREBASE uid and
   * not ours (D-36). Carried here so a caller cannot accidentally pass a Parthik id
   * to Firebase — a mistake that would fail silently as "user not found" and leave
   * refresh tokens live after a "sign out everywhere".
   */
  firebaseUid: string;
  phone: string | null;
  fullName: string | null;
  preferredLocale: UserRecord['preferredLocale'];
  status: UserRecord['status'];
  roles: RoleGrant[];
  /** Union of permissions across every live grant. */
  permissions: ReadonlySet<PermissionKey>;
}

/** A resource whose ownership or tenancy must be respected. */
export interface ResourceScope {
  /** For vendor-scoped resources: which vendor owns it. */
  vendorId?: string | undefined;
  /** For store-scoped resources. */
  storeId?: string | undefined;
  /** For user-owned resources: who owns it. */
  ownerUserId?: string | undefined;
}

export function buildActor(input: {
  userId: string;
  sessionId: string;
  user: UserRecord;
  roles: RoleGrant[];
}): Actor {
  return {
    userId: input.userId,
    sessionId: input.sessionId,
    firebaseUid: input.user.firebaseUid,
    phone: input.user.phone,
    fullName: input.user.fullName,
    preferredLocale: input.user.preferredLocale,
    status: input.user.status,
    roles: input.roles,
    permissions: permissionsForGrants(input.roles),
  };
}

/**
 * Does this actor hold a permission?
 *
 * When `scope` names a vendor or store, the permission must come from a grant that
 * COVERS that scope. Without this check, `VENDOR_STAFF` at vendor A holding
 * `order:update_status` could advance vendor B's order — the classic broken
 * multi-tenant authorization bug, where the permission is right and the tenant is
 * not.
 */
export function can(actor: Actor, permission: PermissionKey, scope?: ResourceScope): boolean {
  // A suspended or banned account holds nothing, whatever its grants say.
  if (!isActiveStatus(actor.status)) return false;

  if (!actor.permissions.has(permission)) return false;

  if (!scope?.vendorId && !scope?.storeId) return true;

  return actor.roles.some((grant) => grantCoversScope(grant, permission, scope));
}

/**
 * Whether one grant both carries the permission and reaches the scope.
 *
 * A GLOBAL grant (admins) reaches every tenant. A VENDOR grant reaches only its own
 * vendor. A STORE grant reaches only its own store.
 */
function grantCoversScope(
  grant: RoleGrant,
  permission: PermissionKey,
  scope: ResourceScope
): boolean {
  if (!permissionsForGrant(grant).has(permission)) return false;

  switch (grant.scopeType) {
    case 'GLOBAL':
      return true;

    case 'VENDOR':
      // A vendor-scoped grant covers the vendor, and by extension its stores. When a
      // storeId is supplied without a vendorId we cannot prove containment here, so
      // we deny and let the caller pass the owning vendor.
      if (scope.vendorId) return grant.scopeId === scope.vendorId;
      return false;

    case 'STORE':
      if (scope.storeId) return grant.scopeId === scope.storeId;
      return false;

    default:
      // Unreachable today; an unrecognised scope type must not grant access.
      return false;
  }
}

function permissionsForGrants(grants: readonly RoleGrant[]): ReadonlySet<PermissionKey> {
  const effective = new Set<PermissionKey>();
  for (const grant of grants) {
    for (const permission of permissionsForGrant(grant)) effective.add(permission);
  }
  return effective;
}

function permissionsForGrant(grant: RoleGrant): ReadonlySet<PermissionKey> {
  // SUPER_ADMIN remains an explicit wildcard role. The permissions table stores
  // concrete keys only, so the wildcard itself never needs a database row.
  if (grant.roleKey === 'SUPER_ADMIN') return permissionsForRoles(['SUPER_ADMIN']);

  // PostgreSQL role grants carry the current database permission set. An empty
  // array is meaningful: the role has intentionally been stripped of permissions.
  if (grant.permissions) return new Set(grant.permissions);

  // The memory test backend has no role_permissions table; keep its canonical
  // fixture behavior without making production authorization depend on it.
  return permissionsForRoles([grant.roleKey]);
}

function isActiveStatus(status: UserRecord['status']): boolean {
  return status === 'ACTIVE';
}

/**
 * Throws unless the actor holds the permission.
 *
 * The thrown error carries the permission key so the response and the log say WHICH
 * permission was missing — "Forbidden" with no detail is the kind of message that
 * turns a two-minute fix into a support ticket.
 */
export function requirePermission(
  actor: Actor | null,
  permission: PermissionKey,
  scope?: ResourceScope
): Actor {
  if (!actor) {
    throw new AuthenticationError('UNAUTHENTICATED', 'Please sign in to continue.');
  }

  if (!isActiveStatus(actor.status)) {
    throw new AuthorizationError('ACCOUNT_SUSPENDED', 'This account is not active.', {
      context: { userId: actor.userId, status: actor.status },
    });
  }

  if (!can(actor, permission, scope)) {
    throw new AuthorizationError('PERMISSION_REQUIRED', 'You do not have permission to do that.', {
      context: { userId: actor.userId, permission, scope },
      // Safe to return: it tells an operator what to grant, and reveals nothing
      // about the resource itself.
      details: { permission },
    });
  }

  return actor;
}

/** Requires only authentication, for surfaces where ownership is the real check. */
export function requireActor(actor: Actor | null): Actor {
  if (!actor) {
    throw new AuthenticationError('UNAUTHENTICATED', 'Please sign in to continue.');
  }
  if (!isActiveStatus(actor.status)) {
    throw new AuthorizationError('ACCOUNT_SUSPENDED', 'This account is not active.', {
      context: { userId: actor.userId, status: actor.status },
    });
  }
  return actor;
}

/**
 * Ownership check for customer-owned resources.
 *
 * Deliberately a NotFound-shaped denial at the call site rather than a 403: telling
 * an attacker "this order exists but is not yours" is itself a disclosure
 * (docs/SECURITY.md §5.4). This helper reports the boolean and lets the service
 * choose the error.
 */
export function ownsResource(actor: Actor, scope: ResourceScope): boolean {
  return Boolean(scope.ownerUserId) && scope.ownerUserId === actor.userId;
}

/** Vendor ids this actor administers, for repository tenant scoping. */
export function vendorScopeIdsFor(actor: Actor): string[] {
  return actor.roles
    .filter((grant) => grant.scopeType === 'VENDOR' && grant.scopeId !== null)
    .map((grant) => grant.scopeId as string);
}

/** Role keys held, for coarse surface routing and cookie claims. */
export function roleKeysFor(actor: Actor): RoleKey[] {
  return [...new Set(actor.roles.map((grant) => grant.roleKey))];
}

/**
 * Surfaces these roles may reach.
 *
 * Used for the post-sign-in landing decision and the middleware wrong-surface
 * redirect. Every authenticated user reaches `customer`, because the shop is
 * available to everyone who is signed in.
 */
export function surfacesForRoles(roleKeys: readonly string[]): Set<SurfaceKind> {
  const surfaces = new Set<SurfaceKind>(['customer']);

  for (const roleKey of roleKeys) {
    const surface = ROLE_SURFACES[roleKey as RoleKey];
    if (surface) surfaces.add(surface);
  }

  return surfaces;
}

/**
 * Where a user lands after sign-in.
 *
 * Most privileged surface first: an admin who signs in expects the admin dashboard,
 * not the shop. A plain customer lands on the shop.
 */
export function landingSurfaceForRoles(roleKeys: readonly string[]): SurfaceKind {
  const surfaces = surfacesForRoles(roleKeys);

  if (surfaces.has('admin')) return 'admin';
  if (surfaces.has('vendor')) return 'vendor';
  if (surfaces.has('driver')) return 'driver';
  return 'customer';
}

/**
 * Which session lifetime applies (D-10).
 *
 * The SHORTEST applicable lifetime wins: a user who is both a customer and an admin
 * gets the 8-hour admin session, because the privileged capability is what sets the
 * risk. Granting the 30-day customer lifetime to an account that can issue refunds
 * would defeat the point of having role-specific lifetimes at all.
 */
export function sessionAudienceForRoles(
  roleKeys: readonly string[]
): 'customer' | 'vendor' | 'driver' | 'admin' {
  const surfaces = surfacesForRoles(roleKeys);

  if (surfaces.has('admin')) return 'admin';
  if (surfaces.has('vendor')) return 'vendor';
  if (surfaces.has('driver')) return 'driver';
  return 'customer';
}
