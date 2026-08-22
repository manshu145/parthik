/**
 * View models for the order UI.
 *
 * WHY THESE EXIST: the ESLint import boundary forbids `components/**` from importing
 * `@/modules/*`, so a presentational component cannot reference `OrderDetail` directly.
 * These are the narrow STRUCTURAL shapes the components actually need, and the module's
 * records are assignable to them, so pages pass service results straight through.
 *
 * Same pattern as `lib/checkout/view.ts` and `lib/marketing/view.ts`.
 */

export type OrderStatusView =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'CONFIRMED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED_DELIVERY'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'RETURNED';

/**
 * The order stages a CUSTOMER is shown, in order.
 *
 * Deliberately fewer than the 14 real statuses. `ASSIGNED` and `PICKED_UP` are operational
 * detail — a customer does not need to know a driver was assigned before the driver has
 * actually collected the food, and showing every internal hop makes the tracker feel like a
 * log file rather than a progress bar.
 */
export const CUSTOMER_ORDER_STAGES = [
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;

export type CustomerOrderStage = (typeof CUSTOMER_ORDER_STAGES)[number];

/**
 * Maps a real status onto the stage the customer sees.
 *
 * Returns null for statuses that are not part of forward progress at all (cancelled, failed,
 * refunded), because rendering those on a progress bar would imply the order is still moving.
 */
export function stageForStatus(status: OrderStatusView): CustomerOrderStage | null {
  switch (status) {
    case 'CONFIRMED':
    case 'ACCEPTED':
      return 'CONFIRMED';
    case 'PREPARING':
      return 'PREPARING';
    case 'READY_FOR_PICKUP':
    case 'ASSIGNED':
      return 'READY_FOR_PICKUP';
    case 'PICKED_UP':
    case 'OUT_FOR_DELIVERY':
      return 'OUT_FOR_DELIVERY';
    case 'DELIVERED':
      return 'DELIVERED';
    default:
      return null;
  }
}

/** How a status should be coloured. Matches the `Badge` variants exactly. */
export function toneForStatus(
  status: OrderStatusView
): 'neutral' | 'success' | 'danger' | 'warning' | 'primary' {
  switch (status) {
    case 'DELIVERED':
      return 'success';
    case 'CANCELLED':
    case 'PAYMENT_FAILED':
    case 'FAILED_DELIVERY':
    case 'RETURNED':
      return 'danger';
    case 'PENDING_PAYMENT':
    case 'REFUNDED':
      return 'warning';
    case 'OUT_FOR_DELIVERY':
    case 'PICKED_UP':
      return 'primary';
    default:
      return 'neutral';
  }
}

export interface OrderListItemView {
  id: string;
  orderNumber: string;
  status: OrderStatusView;
  totalAmountPaise: number;
  itemCount: number;
  thumbnailKey: string | null;
  firstItemName: string;
  createdAt: Date | string;
  isCod: boolean;
}

export interface OrderLineView {
  id: string;
  productNameSnapshot: string;
  variantLabelSnapshot: string | null;
  unitLabelSnapshot: string | null;
  quantity: number;
  mrpPaise: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export interface OrderTimelineEventView {
  id: string;
  fromStatus: OrderStatusView | null;
  toStatus: OrderStatusView;
  reason: string | null;
  createdAt: Date | string;
}

/**
 * The order as the summary renders it.
 *
 * Has NO tax field, the same way `CheckoutTotalsView` has none: D-14 is blocked, so the view
 * model cannot express a tax line at all and "we accidentally printed ₹0 GST on something
 * that looks like an invoice" is impossible rather than merely discouraged
 * (docs/ARCHITECTURE.md §11.2.2, docs/ROUTES.md §14).
 */
export interface OrderSummaryView {
  id: string;
  orderNumber: string;
  status: OrderStatusView;
  grossAmountPaise: number;
  itemDiscountPaise: number;
  couponCodeSnapshot: string | null;
  couponDiscountPaise: number;
  deliveryFeePaise: number;
  packagingFeePaise: number;
  serviceFeePaise: number;
  totalAmountPaise: number;
  paymentMethod: 'UPI' | 'CARD' | 'COD';
  paymentStatus: string;
  isCod: boolean;
  codAmountPaise: number | null;
  placedAt: Date | string | null;
  estimatedDeliveryAt: Date | string | null;
  deliveredAt: Date | string | null;
  cancelledAt: Date | string | null;
  cancellationReason: string | null;
  contactName: string;
  contactPhone: string;
  deliveryAddressSnapshot: Record<string, unknown>;
  customerNote: string | null;
}

export interface OrderDetailView {
  order: OrderSummaryView;
  lines: OrderLineView[];
  timeline: OrderTimelineEventView[];
  isActive: boolean;
  canCancel: boolean;
}

/**
 * Reads the frozen address snapshot for display.
 *
 * The snapshot is `Record<string, unknown>` because it is a historical copy whose shape must
 * not be tied to today's address columns — an order placed last year has to keep rendering
 * after the address table changes. So the reader is defensive by design rather than by
 * accident.
 */
export function formatAddressSnapshot(snapshot: Record<string, unknown>): string {
  const parts = ['line1', 'line2', 'landmark', 'city', 'state', 'pincode']
    .map((key) => snapshot[key])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '');

  return parts.join(', ');
}
