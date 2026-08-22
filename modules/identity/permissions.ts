/**
 * The permission catalogue and role→permission map (docs/SECURITY.md §5.2, §5.3).
 *
 * This lives in the identity MODULE rather than in `db/seed/` because it is domain
 * knowledge, not seed data: the RBAC engine and the seeder must agree, and the only
 * way to guarantee that is for both to read the same declaration. `db/seed/`
 * re-exports from here, so a permission added for a new feature cannot be granted
 * to a role that the database has never heard of.
 *
 * Permission keys are `resource:action`. Roles bundle permissions; a user may hold
 * several roles and the effective set is their union (docs/SECURITY.md §5.1).
 */

export const PERMISSION_KEYS = [
  // Orders
  'order:list',
  'order:view',
  'order:update_status',
  'order:cancel',
  'order:note',

  // Payments and money
  'payment:view',
  'payment:reconcile',
  'refund:manage',
  'payout:manage',

  // COD cash — three separate permissions so that verifying a deposit and writing
  // off a shortfall need not be the same person (docs/SECURITY.md §5.2).
  'cash:view',
  'cash:reconcile',
  'cash:adjust',

  // Catalog
  'product:list',
  'product:view',
  'product:manage',
  'product:publish',
  'product:approve',
  'category:manage',
  'brand:manage',
  'inventory:view',
  'inventory:manage',

  // Customers
  'customer:list',
  'customer:view',
  'customer:suspend',

  // Vendors
  'vendor:list',
  'vendor:view',
  'vendor:approve',
  'vendor:suspend',
  'vendor:kyc_review',

  // Drivers and delivery
  'driver:list',
  'driver:view',
  'driver:approve',
  'driver:suspend',
  'delivery:view',
  'delivery:assign',
  'zone:manage',

  // Marketing and content
  'coupon:manage',
  'promotion:manage',
  'banner:manage',
  'cms:manage',
  'campaign:manage',
  'template:manage',

  // Engagement
  'review:moderate',
  'ticket:list',
  'ticket:view',
  'ticket:reply',
  'ticket:manage',
  'notification:manage',

  // Reporting and platform
  'dashboard:view',
  'analytics:view',
  'report:view',
  'setting:view',
  'setting:manage',
  'setting:manage_sensitive',
  'role:manage',
  'admin_user:manage',
  'audit:view',
  'system:view',
  'flag:manage',
] as const;

/**
 * A known permission key.
 *
 * Typed as a union rather than `string` deliberately: `requirePermission('order:refnd')`
 * is then a compile error instead of a permission that silently never matches — and
 * a permission that never matches fails CLOSED, which means a working feature
 * quietly becomes unreachable.
 */
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEY_SET.has(value);
}

export const PERMISSION_DESCRIPTIONS: Readonly<Record<PermissionKey, string>> = {
  'order:list': 'List orders',
  'order:view': 'View an order and its timeline',
  'order:update_status': 'Change operational order status',
  'order:cancel': 'Cancel an order',
  'order:note': 'Add an internal note to an order',

  'payment:view': 'View payments',
  'payment:reconcile': 'Reconcile a payment against the provider',
  'refund:manage': 'Initiate and manage refunds',
  'payout:manage': 'Manage vendor and driver payout batches',

  'cash:view': 'View driver cash balances and deposits',
  'cash:reconcile': 'Verify or reject a declared cash deposit',
  'cash:adjust': 'Record a cash adjustment or write-off',

  'product:list': 'List products',
  'product:view': 'View a product',
  'product:manage': 'Create and edit products',
  'product:publish': 'Publish a product',
  'product:approve': 'Approve or reject a submitted product',
  'category:manage': 'Manage the category tree',
  'brand:manage': 'Manage brands',
  'inventory:view': 'View stock levels',
  'inventory:manage': 'Adjust stock',

  'customer:list': 'List customers',
  'customer:view': 'View a customer',
  'customer:suspend': 'Suspend or ban a customer',

  'vendor:list': 'List vendors',
  'vendor:view': 'View a vendor',
  'vendor:approve': 'Approve or reject a vendor application',
  'vendor:suspend': 'Suspend a vendor',
  'vendor:kyc_review': 'Review vendor KYC documents',

  'driver:list': 'List drivers',
  'driver:view': 'View a driver',
  'driver:approve': 'Approve or reject a driver application',
  'driver:suspend': 'Suspend a driver',
  'delivery:view': 'View deliveries and the dispatch board',
  'delivery:assign': 'Assign or reassign a driver',
  'zone:manage': 'Manage delivery zones, pincodes and fees',

  'coupon:manage': 'Manage coupons',
  'promotion:manage': 'Manage promotions',
  'banner:manage': 'Manage banners',
  'cms:manage': 'Manage CMS pages, blog, home layout, redirects',
  'campaign:manage': 'Create and schedule campaigns',
  'template:manage': 'Manage notification templates',

  'review:moderate': 'Moderate reviews',
  'ticket:list': 'List support tickets',
  'ticket:view': 'View a support ticket',
  'ticket:reply': 'Reply to a support ticket',
  'ticket:manage': 'Assign and change ticket status',
  'notification:manage': 'Send notifications',

  'dashboard:view': 'View the admin dashboard',
  'analytics:view': 'View analytics',
  'report:view': 'Generate and download reports',
  'setting:view': 'View settings',
  'setting:manage': 'Change settings',
  'setting:manage_sensitive': 'Change sensitive settings',
  'role:manage': 'Manage roles and permissions',
  'admin_user:manage': 'Manage admin users',
  'audit:view': 'View audit logs',
  'system:view': 'View system health',
  'flag:manage': 'Manage feature flags',
};

/** Role keys, matching the `role_key` Postgres enum in db/schema/enums.ts. */
export const ROLE_KEYS = [
  'CUSTOMER',
  'VENDOR_OWNER',
  'VENDOR_STAFF',
  'DRIVER',
  'ADMIN',
  'ADMIN_SUPPORT',
  'ADMIN_OPS',
  'ADMIN_FINANCE',
  'SUPER_ADMIN',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

const ROLE_KEY_SET: ReadonlySet<string> = new Set(ROLE_KEYS);

export function isRoleKey(value: string): value is RoleKey {
  return ROLE_KEY_SET.has(value);
}

/** `'*'` means every permission. Only SUPER_ADMIN holds it. */
export const WILDCARD_PERMISSION = '*';

export const ROLE_PERMISSION_MAP: Readonly<
  Record<RoleKey, readonly PermissionKey[] | readonly ['*']>
> = {
  // Customers and drivers act only on their own resources. Ownership is checked in
  // the service layer, so they hold no catalogue permissions at all — an empty set
  // here is the correct answer, not an oversight.
  CUSTOMER: [],
  DRIVER: [],

  VENDOR_OWNER: [
    'order:list',
    'order:view',
    'order:update_status',
    'product:list',
    'product:view',
    'product:manage',
    'product:publish',
    'inventory:view',
    'inventory:manage',
    'analytics:view',
  ],

  // No bank details and no staff management — those are the owner's alone.
  VENDOR_STAFF: [
    'order:list',
    'order:view',
    'order:update_status',
    'product:list',
    'product:view',
    'product:manage',
    'inventory:view',
    'inventory:manage',
  ],

  ADMIN_SUPPORT: [
    'dashboard:view',
    'order:list',
    'order:view',
    'order:note',
    'customer:list',
    'customer:view',
    'ticket:list',
    'ticket:view',
    'ticket:reply',
    'delivery:view',
  ],

  ADMIN_OPS: [
    'dashboard:view',
    'order:list',
    'order:view',
    'order:update_status',
    'order:cancel',
    'order:note',
    'customer:list',
    'customer:view',
    'vendor:list',
    'vendor:view',
    'vendor:approve',
    'vendor:kyc_review',
    'driver:list',
    'driver:view',
    'driver:approve',
    'delivery:view',
    'delivery:assign',
    'zone:manage',
    'inventory:view',
    'product:list',
    'product:view',
    'product:approve',
    // Ops needs to see which drivers are over the cash limit to understand dispatch
    // behaviour, but may not verify deposits or adjust balances.
    'cash:view',
    'ticket:list',
    'ticket:view',
    'system:view',
  ],

  ADMIN_FINANCE: [
    'dashboard:view',
    'order:list',
    'order:view',
    'payment:view',
    'payment:reconcile',
    'refund:manage',
    'payout:manage',
    'cash:view',
    'cash:reconcile',
    'report:view',
    'analytics:view',
  ],

  // Everything operational, marketing and CMS — but NOT RBAC, NOT sensitive
  // settings, and NOT cash adjustments.
  ADMIN: [
    'dashboard:view',
    'order:list',
    'order:view',
    'order:update_status',
    'order:cancel',
    'order:note',
    'payment:view',
    'refund:manage',
    'payout:manage',
    'cash:view',
    'cash:reconcile',
    'customer:list',
    'customer:view',
    'customer:suspend',
    'vendor:list',
    'vendor:view',
    'vendor:approve',
    'vendor:suspend',
    'vendor:kyc_review',
    'driver:list',
    'driver:view',
    'driver:approve',
    'driver:suspend',
    'delivery:view',
    'delivery:assign',
    'zone:manage',
    'product:list',
    'product:view',
    'product:manage',
    'product:approve',
    'category:manage',
    'brand:manage',
    'inventory:view',
    'inventory:manage',
    'coupon:manage',
    'promotion:manage',
    'banner:manage',
    'cms:manage',
    'campaign:manage',
    'template:manage',
    'review:moderate',
    'ticket:list',
    'ticket:view',
    'ticket:reply',
    'ticket:manage',
    'notification:manage',
    'analytics:view',
    'report:view',
    'setting:view',
    'audit:view',
    'system:view',
  ],

  SUPER_ADMIN: [WILDCARD_PERMISSION],
};

/**
 * Which surface a role may reach. Consumed by middleware for coarse routing and by
 * the sign-in redirect to decide where a user lands.
 *
 * This is NOT authorization — it decides which page SHELL is reachable. The
 * permission check inside the page decides whether any data is returned.
 */
export const ROLE_SURFACES: Readonly<Record<RoleKey, 'customer' | 'vendor' | 'driver' | 'admin'>> =
  {
    CUSTOMER: 'customer',
    VENDOR_OWNER: 'vendor',
    VENDOR_STAFF: 'vendor',
    DRIVER: 'driver',
    ADMIN: 'admin',
    ADMIN_SUPPORT: 'admin',
    ADMIN_OPS: 'admin',
    ADMIN_FINANCE: 'admin',
    SUPER_ADMIN: 'admin',
  };

/**
 * Expands a role to its concrete permission set, resolving the wildcard.
 *
 * Unknown role keys yield an EMPTY set rather than throwing. Fail closed: a role
 * the code does not recognise must grant nothing, which is the safe outcome if the
 * database ever holds a role this build predates.
 */
export function permissionsForRole(roleKey: string): ReadonlySet<PermissionKey> {
  if (!isRoleKey(roleKey)) return new Set();

  const granted = ROLE_PERMISSION_MAP[roleKey];
  if (granted.length === 1 && granted[0] === WILDCARD_PERMISSION) {
    return new Set(PERMISSION_KEYS);
  }

  return new Set(granted as readonly PermissionKey[]);
}

/** The union of permissions across every role a user holds. */
export function permissionsForRoles(roleKeys: readonly string[]): ReadonlySet<PermissionKey> {
  const effective = new Set<PermissionKey>();
  for (const roleKey of roleKeys) {
    for (const permission of permissionsForRole(roleKey)) {
      effective.add(permission);
    }
  }
  return effective;
}

/** Splits `resource:action` for the `permissions` table's denormalised columns. */
export function splitPermissionKey(key: PermissionKey): { resource: string; action: string } {
  const separator = key.indexOf(':');
  return { resource: key.slice(0, separator), action: key.slice(separator + 1) };
}
