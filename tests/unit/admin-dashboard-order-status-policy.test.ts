import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '@/modules/order/order.state';
import {
  CLOSED_ORDER_STATUSES,
  isOpenAdminDashboardOrder,
} from '@/modules/admin-dashboard/order-status-policy';

describe('admin dashboard open-order KPI policy', () => {
  it('only excludes valid closed order statuses from the open-order count', () => {
    expect(CLOSED_ORDER_STATUSES).toEqual(['DELIVERED', 'CANCELLED', 'REFUNDED', 'RETURNED']);
  });

  it.each(CLOSED_ORDER_STATUSES)('treats %s as closed', (status) => {
    expect(isOpenAdminDashboardOrder(status)).toBe(false);
  });

  it.each([
    'PENDING_PAYMENT',
    'CONFIRMED',
    'ACCEPTED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'ASSIGNED',
    'PICKED_UP',
    'OUT_FOR_DELIVERY',
    'PAYMENT_FAILED',
    'FAILED_DELIVERY',
  ] satisfies OrderStatus[])('keeps recoverable or operational status %s open', (status) => {
    expect(isOpenAdminDashboardOrder(status)).toBe(true);
  });
});
