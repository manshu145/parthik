import type { OrderStatus } from '@/modules/order/order.state';

/**
 * An order is closed for the admin landing-page "open orders" KPI when no further
 * operational fulfilment is expected. PAYMENT_FAILED and FAILED_DELIVERY are
 * deliberately still open: the state machine allows failed-payment recovery and
 * driver reassignment from failed delivery.
 */
export const CLOSED_ORDER_STATUSES = [
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
  'RETURNED',
] as const satisfies readonly OrderStatus[];

const closedOrderStatusSet = new Set<OrderStatus>(CLOSED_ORDER_STATUSES);

export function isOpenAdminDashboardOrder(status: OrderStatus): boolean {
  return !closedOrderStatusSet.has(status);
}
