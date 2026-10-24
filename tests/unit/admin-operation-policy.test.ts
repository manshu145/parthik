import { describe, expect, it } from 'vitest';
import { isAdminOperationActionAllowed } from '@/modules/admin-operations/admin-operation-policy';

describe('admin operation action policy', () => {
  it.each([
    ['review:moderate', 'approve', true],
    ['review:moderate', 'reject', true],
    ['review:moderate', 'enable', false],
    ['review:moderate', 'disable', false],
    ['coupon:manage', 'enable', true],
    ['coupon:manage', 'disable', true],
    ['coupon:manage', 'approve', false],
    ['promotion:manage', 'enable', true],
    ['promotion:manage', 'reject', false],
    ['banner:manage', 'disable', true],
    ['template:manage', 'enable', true],
    ['flag:manage', 'disable', true],
    ['admin_user:manage', 'enable', true],
    ['dashboard:view', 'enable', false],
    ['dashboard:view', 'approve', false],
  ] as const)('%s + %s is allowed: %s', (permission, action, expected) => {
    expect(isAdminOperationActionAllowed(permission, action)).toBe(expected);
  });
});
