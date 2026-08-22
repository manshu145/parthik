import { describe, expect, it } from 'vitest';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { PERMISSIONS, ROLE_PERMISSIONS } from '@/db/seed/reference-data';
import {
  buildActor,
  can,
  landingSurfaceForRoles,
  ownsResource,
  requireActor,
  requirePermission,
  roleKeysFor,
  sessionAudienceForRoles,
  surfacesForRoles,
  vendorScopeIdsFor,
  type Actor,
} from '@/modules/identity/identity.policy';
import {
  isPermissionKey,
  isRoleKey,
  permissionsForRole,
  permissionsForRoles,
  PERMISSION_KEYS,
  ROLE_KEYS,
  ROLE_PERMISSION_MAP,
  type PermissionKey,
  type RoleKey,
} from '@/modules/identity/permissions';
import type { RoleGrant, UserRecord } from '@/modules/identity/identity.repository.types';

/**
 * The permission engine (docs/SECURITY.md §5).
 *
 * Two things are tested with equal weight: that permitted actions are ALLOWED, and that
 * everything else is DENIED. The second half is the part that matters — an authorization
 * suite that only asserts the happy path would pass just as happily against a function
 * that returns `true` unconditionally.
 */

const VENDOR_A = 'vendor-aaa';
const VENDOR_B = 'vendor-bbb';
const STORE_A = 'store-aaa';

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-1',
    firebaseUid: 'uid-1',
    phone: '+919876543210',
    phoneVerifiedAt: new Date(),
    email: null,
    fullName: 'Test User',
    preferredLocale: 'en',
    status: 'ACTIVE',
    lastLoginAt: null,
    deletedAt: null,
    anonymizedAt: null,
    ...overrides,
  };
}

function actorWith(roles: RoleGrant[], overrides: Partial<UserRecord> = {}): Actor {
  return buildActor({
    userId: 'user-1',
    sessionId: 'session-1',
    user: user(overrides),
    roles,
  });
}

const global = (roleKey: RoleKey): RoleGrant => ({
  roleKey,
  scopeType: 'GLOBAL',
  scopeId: null,
});

const vendorScoped = (roleKey: RoleKey, scopeId: string): RoleGrant => ({
  roleKey,
  scopeType: 'VENDOR',
  scopeId,
});

describe('registry integrity', () => {
  it('exposes 59 unique permission keys shaped resource:action', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z_]+:[a-z_]+$/);
    }
  });

  it('describes every permission', () => {
    // A permission with no description reaches the admin RBAC screen as a bare key.
    for (const key of PERMISSION_KEYS) {
      expect(PERMISSIONS.find((p) => p.key === key)?.description).toBeTruthy();
    }
  });

  it('grants every role only known permissions', () => {
    // The guard against a typo'd grant, which would fail CLOSED and silently make a
    // working screen unreachable.
    for (const roleKey of ROLE_KEYS) {
      const granted = ROLE_PERMISSION_MAP[roleKey];
      if (granted[0] === '*') continue;
      for (const permission of granted) {
        expect(isPermissionKey(permission), `${roleKey} → ${permission}`).toBe(true);
      }
    }
  });

  it('agrees exactly with what the database seed writes', () => {
    /**
     * The engine and the seeder MUST expose the same catalogue. If they drift, the
     * failure is silent in both directions: a permission the engine checks but the
     * database lacks denies a working feature, and one seeded but unknown to the engine
     * grants nothing. Deriving both from one declaration is what prevents it; this test
     * is what proves the derivation still holds.
     */
    expect(PERMISSIONS.map((p) => p.key).sort()).toEqual([...PERMISSION_KEYS].sort());
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLE_KEYS].sort());
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toEqual(['*']);
  });

  it('resolves the wildcard to every permission', () => {
    expect(permissionsForRole('SUPER_ADMIN').size).toBe(PERMISSION_KEYS.length);
  });

  it('grants nothing for an unknown role', () => {
    // Fail closed: a role this build predates must grant nothing, not everything.
    expect(permissionsForRole('NOT_A_ROLE').size).toBe(0);
    expect(isRoleKey('NOT_A_ROLE')).toBe(false);
  });

  it('unions permissions across several roles', () => {
    const union = permissionsForRoles(['ADMIN_SUPPORT', 'ADMIN_FINANCE']);

    expect(union.has('ticket:reply')).toBe(true); // support only
    expect(union.has('refund:manage')).toBe(true); // finance only
  });

  it('gives customers and drivers no catalogue permissions', () => {
    // They act only on their OWN resources; ownership is checked in the service layer.
    expect(permissionsForRole('CUSTOMER').size).toBe(0);
    expect(permissionsForRole('DRIVER').size).toBe(0);
  });

  it('withholds RBAC, sensitive settings and cash adjustment from plain ADMIN', () => {
    const admin = permissionsForRole('ADMIN');

    // Separation of duties: only SUPER_ADMIN may change who can do what.
    expect(admin.has('role:manage')).toBe(false);
    expect(admin.has('setting:manage_sensitive')).toBe(false);
    expect(admin.has('cash:adjust')).toBe(false);
  });

  it('separates the three cash permissions', () => {
    // docs/SECURITY.md §5.2: verifying a deposit and writing off a shortfall must be
    // separable duties.
    expect(permissionsForRole('ADMIN_OPS').has('cash:view')).toBe(true);
    expect(permissionsForRole('ADMIN_OPS').has('cash:reconcile')).toBe(false);
    expect(permissionsForRole('ADMIN_FINANCE').has('cash:reconcile')).toBe(true);
    expect(permissionsForRole('ADMIN_FINANCE').has('cash:adjust')).toBe(false);
  });
});

describe('can — allow', () => {
  it('allows a permission the role holds', () => {
    expect(can(actorWith([global('ADMIN_SUPPORT')]), 'ticket:reply')).toBe(true);
  });

  it('allows SUPER_ADMIN everything', () => {
    const actor = actorWith([global('SUPER_ADMIN')]);
    for (const key of PERMISSION_KEYS) {
      expect(can(actor, key), key).toBe(true);
    }
  });

  it('allows a GLOBAL grant to act on any tenant', () => {
    // Admins are not vendor-scoped, so a scoped query must still succeed for them.
    const actor = actorWith([global('SUPER_ADMIN')]);
    expect(can(actor, 'order:update_status', { vendorId: VENDOR_A })).toBe(true);
  });
});

describe('can — deny', () => {
  it('denies a permission the role does not hold', () => {
    const support = actorWith([global('ADMIN_SUPPORT')]);

    expect(can(support, 'refund:manage')).toBe(false);
    expect(can(support, 'setting:manage_sensitive')).toBe(false);
    expect(can(support, 'role:manage')).toBe(false);
  });

  it('denies everything to a customer', () => {
    const customer = actorWith([global('CUSTOMER')]);
    for (const key of PERMISSION_KEYS) {
      expect(can(customer, key), key).toBe(false);
    }
  });

  it.each(['SUSPENDED', 'BANNED', 'PENDING', 'DELETED'] as const)(
    'denies everything to a %s account even with SUPER_ADMIN',
    (status) => {
      // Status overrides grants. A banned admin holding every permission must hold none.
      const actor = actorWith([global('SUPER_ADMIN')], { status });
      expect(can(actor, 'order:list')).toBe(false);
    }
  );
});

describe('can — tenant scope containment', () => {
  it('allows a vendor-scoped grant on its own vendor', () => {
    const actor = actorWith([vendorScoped('VENDOR_OWNER', VENDOR_A)]);

    expect(can(actor, 'order:update_status', { vendorId: VENDOR_A })).toBe(true);
  });

  it('denies a vendor-scoped grant on another vendor', () => {
    /**
     * The bug this exists to prevent: VENDOR_STAFF at vendor A holding
     * `order:update_status` advancing vendor B's order. The permission is right and the
     * tenant is not, which is the classic broken multi-tenant check.
     */
    const actor = actorWith([vendorScoped('VENDOR_STAFF', VENDOR_A)]);

    expect(can(actor, 'order:update_status', { vendorId: VENDOR_A })).toBe(true);
    expect(can(actor, 'order:update_status', { vendorId: VENDOR_B })).toBe(false);
  });

  it('denies a vendor-scoped grant when only a store is named', () => {
    // Containment cannot be proven without the owning vendor, so it denies rather than
    // guessing.
    const actor = actorWith([vendorScoped('VENDOR_OWNER', VENDOR_A)]);

    expect(can(actor, 'order:update_status', { storeId: STORE_A })).toBe(false);
  });

  it('honours a STORE-scoped grant on its own store', () => {
    const actor = actorWith([{ roleKey: 'VENDOR_STAFF', scopeType: 'STORE', scopeId: STORE_A }]);

    expect(can(actor, 'order:view', { storeId: STORE_A })).toBe(true);
    expect(can(actor, 'order:view', { storeId: 'store-other' })).toBe(false);
  });

  it('keeps two vendor grants independent', () => {
    // A user may legitimately hold roles at two vendors; each must reach only its own.
    const actor = actorWith([
      vendorScoped('VENDOR_OWNER', VENDOR_A),
      vendorScoped('VENDOR_STAFF', VENDOR_B),
    ]);

    // Owner-only permission at A, but not at B where they are only staff.
    expect(can(actor, 'product:publish', { vendorId: VENDOR_A })).toBe(true);
    expect(can(actor, 'product:publish', { vendorId: VENDOR_B })).toBe(false);
  });
});

describe('requirePermission', () => {
  it('returns the actor when permitted', () => {
    const actor = actorWith([global('SUPER_ADMIN')]);
    expect(requirePermission(actor, 'order:list')).toBe(actor);
  });

  it('throws AuthenticationError for no actor', () => {
    expect(() => requirePermission(null, 'order:list')).toThrow(AuthenticationError);
  });

  it('throws AuthorizationError with ACCOUNT_SUSPENDED for an inactive account', () => {
    const actor = actorWith([global('SUPER_ADMIN')], { status: 'SUSPENDED' });

    expect(() => requirePermission(actor, 'order:list')).toThrow(AuthorizationError);
    expect(() => requirePermission(actor, 'order:list')).toThrowError(
      expect.objectContaining({ code: 'ACCOUNT_SUSPENDED' })
    );
  });

  it('throws PERMISSION_REQUIRED and names the permission in details', () => {
    // The key is returned so an operator knows what to grant. It says nothing about the
    // resource, so it is safe to surface.
    const actor = actorWith([global('ADMIN_SUPPORT')]);

    expect(() => requirePermission(actor, 'refund:manage')).toThrowError(
      expect.objectContaining({
        code: 'PERMISSION_REQUIRED',
        details: { permission: 'refund:manage' },
      })
    );
  });

  it('enforces scope, not just the permission', () => {
    const actor = actorWith([vendorScoped('VENDOR_OWNER', VENDOR_A)]);

    expect(() => requirePermission(actor, 'order:view', { vendorId: VENDOR_B })).toThrow(
      AuthorizationError
    );
  });
});

describe('requireActor', () => {
  it('returns an active actor', () => {
    const actor = actorWith([global('CUSTOMER')]);
    expect(requireActor(actor)).toBe(actor);
  });

  it('throws for null', () => {
    expect(() => requireActor(null)).toThrow(AuthenticationError);
  });

  it('throws for a suspended actor', () => {
    expect(() => requireActor(actorWith([global('CUSTOMER')], { status: 'BANNED' }))).toThrow(
      AuthorizationError
    );
  });
});

describe('surfaces and landing', () => {
  it('always includes the customer surface for a signed-in user', () => {
    // The shop is available to everyone signed in, including drivers and admins.
    expect(surfacesForRoles(['SUPER_ADMIN']).has('customer')).toBe(true);
    expect(surfacesForRoles(['DRIVER']).has('customer')).toBe(true);
  });

  it.each([
    ['CUSTOMER', 'customer'],
    ['VENDOR_OWNER', 'vendor'],
    ['VENDOR_STAFF', 'vendor'],
    ['DRIVER', 'driver'],
    ['ADMIN', 'admin'],
    ['ADMIN_SUPPORT', 'admin'],
    ['ADMIN_OPS', 'admin'],
    ['ADMIN_FINANCE', 'admin'],
    ['SUPER_ADMIN', 'admin'],
  ])('maps %s to the %s surface', (roleKey, surface) => {
    expect(surfacesForRoles([roleKey]).has(surface as 'admin')).toBe(true);
  });

  it('does not grant a surface a role has no claim to', () => {
    const vendor = surfacesForRoles(['VENDOR_OWNER']);

    expect(vendor.has('admin')).toBe(false);
    expect(vendor.has('driver')).toBe(false);
  });

  it('ignores unknown roles when resolving surfaces', () => {
    expect([...surfacesForRoles(['NOT_A_ROLE'])]).toEqual(['customer']);
  });

  it.each([
    [['CUSTOMER'], 'customer'],
    [['DRIVER'], 'driver'],
    [['VENDOR_OWNER'], 'vendor'],
    [['ADMIN_SUPPORT'], 'admin'],
    // Most privileged first: an admin expects the dashboard, not the shop.
    [['CUSTOMER', 'SUPER_ADMIN'], 'admin'],
    [['CUSTOMER', 'DRIVER'], 'driver'],
    [['CUSTOMER', 'VENDOR_OWNER', 'DRIVER'], 'vendor'],
  ])('lands %s on the %s surface', (roles, expected) => {
    expect(landingSurfaceForRoles(roles)).toBe(expected);
  });
});

describe('sessionAudienceForRoles', () => {
  it.each([
    [['CUSTOMER'], 'customer'],
    [['DRIVER'], 'driver'],
    [['VENDOR_STAFF'], 'vendor'],
    [['ADMIN_FINANCE'], 'admin'],
  ])('maps %s to the %s lifetime band', (roles, expected) => {
    expect(sessionAudienceForRoles(roles)).toBe(expected);
  });

  it('gives an admin-capable account the SHORTEST lifetime', () => {
    /**
     * A user who is both customer and admin must get the 8-hour admin session, not the
     * 30-day customer one. Granting a month-long session to an account that can issue
     * refunds would defeat the point of role-specific lifetimes entirely.
     */
    expect(sessionAudienceForRoles(['CUSTOMER', 'SUPER_ADMIN'])).toBe('admin');
    expect(sessionAudienceForRoles(['CUSTOMER', 'VENDOR_OWNER'])).toBe('vendor');
  });
});

describe('helpers', () => {
  it('lists vendor scope ids for repository tenant filtering', () => {
    const actor = actorWith([
      global('CUSTOMER'),
      vendorScoped('VENDOR_OWNER', VENDOR_A),
      vendorScoped('VENDOR_STAFF', VENDOR_B),
    ]);

    expect(vendorScopeIdsFor(actor).sort()).toEqual([VENDOR_A, VENDOR_B].sort());
  });

  it('excludes global grants from vendor scope ids', () => {
    expect(vendorScopeIdsFor(actorWith([global('SUPER_ADMIN')]))).toEqual([]);
  });

  it('de-duplicates role keys', () => {
    const actor = actorWith([
      vendorScoped('VENDOR_STAFF', VENDOR_A),
      vendorScoped('VENDOR_STAFF', VENDOR_B),
    ]);

    expect(roleKeysFor(actor)).toEqual(['VENDOR_STAFF']);
  });

  it('recognises ownership only for the owning user', () => {
    const actor = actorWith([global('CUSTOMER')]);

    expect(ownsResource(actor, { ownerUserId: 'user-1' })).toBe(true);
    expect(ownsResource(actor, { ownerUserId: 'user-2' })).toBe(false);
    expect(ownsResource(actor, {})).toBe(false);
  });
});

describe('buildActor', () => {
  it('derives the effective permission set from grants', () => {
    const actor = actorWith([global('ADMIN_SUPPORT')]);

    expect(actor.permissions.has('ticket:reply')).toBe(true);
    expect(actor.permissions.size).toBe(permissionsForRole('ADMIN_SUPPORT').size);
  });

  it('carries the firebase uid, needed for Identity Platform calls', () => {
    // Passing a Parthik id to Firebase fails as "user not found", which would leave
    // refresh tokens live after a "sign out everywhere".
    expect(actorWith([global('CUSTOMER')]).firebaseUid).toBe('uid-1');
  });

  it('exposes no permissions the role map does not grant', () => {
    const actor = actorWith([global('VENDOR_STAFF')]);
    const expected = permissionsForRole('VENDOR_STAFF');

    for (const key of actor.permissions) {
      expect(expected.has(key as PermissionKey)).toBe(true);
    }
  });
});
