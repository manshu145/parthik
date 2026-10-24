import type { PermissionKey } from '@/modules/identity';

/**
 * Each admin operation accepts only the verbs that make sense for that resource.
 * Keep this allowlist server-side: a UI control is not an authorization boundary.
 */
const ACTIONS = {
  'review:moderate': ['approve', 'reject'],
  'coupon:manage': ['enable', 'disable'],
  'promotion:manage': ['enable', 'disable'],
  'banner:manage': ['enable', 'disable'],
  'template:manage': ['enable', 'disable'],
  'flag:manage': ['enable', 'disable'],
  'admin_user:manage': ['enable', 'disable'],
} as const satisfies Partial<Record<PermissionKey, readonly string[]>>;

export function isAdminOperationActionAllowed(permission: PermissionKey, action: string): boolean {
  const allowed = (ACTIONS as Partial<Record<PermissionKey, readonly string[]>>)[permission];
  return allowed?.includes(action) ?? false;
}
