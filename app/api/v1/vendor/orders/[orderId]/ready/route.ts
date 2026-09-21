import { logger } from '@/lib/logger';
import { handleVendorOrderAction } from '@/lib/http/vendor-order-action';
import { getDeliveryService } from '@/modules/delivery';
import { getOrderService } from '@/modules/order';

/**
 * POST /api/v1/vendor/orders/:orderId/ready — the order is packed, and DISPATCH STARTS.
 *
 * PREPARING -> READY_FOR_PICKUP carries the `REQUEST_DISPATCH` effect, and this is where that
 * effect is actually honoured: a delivery row is created so drivers can be offered the job.
 *
 * Dispatch runs AFTER the transition, not inside it. If creating the delivery fails, the order is
 * still correctly READY_FOR_PICKUP and an admin can assign a driver by hand — whereas rolling the
 * transition back would leave a packed order sitting in PREPARING with nobody looking at it.
 * Failure is logged loudly and reported in the response rather than swallowed.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return handleVendorOrderAction(request, context, {
    to: 'READY_FOR_PICKUP',
    afterTransition: async ({ orderId }) => {
      try {
        const [orders, deliveries] = await Promise.all([getOrderService(), getDeliveryService()]);
        const detail = await orders.getForOperations(orderId);

        const result = await deliveries.dispatchForOrder({
          orderId: detail.order.id,
          storeId: detail.order.storeId,
          deliveryZoneId: detail.order.deliveryZoneId,
          deliveryFeePaise: detail.order.deliveryFeePaise,
          // Snapshotted so the driver is told what to collect even if the order is later edited.
          codExpectedPaise: detail.order.isCod ? detail.order.codAmountPaise : null,
          dropAddressSnapshot: detail.order.deliveryAddressSnapshot,
        });

        /**
         * The OTP generated here is DISCARDED on purpose.
         *
         * Only its hash is stored, so nothing can hand it out later — the customer reveals a fresh
         * code through `POST /api/v1/orders/:id/delivery-code` when the driver arrives. Returning
         * it here would put a live delivery code in a vendor's response.
         */
        return { dispatch: { deliveryId: result.deliveryId, created: result.created } };
      } catch (error) {
        logger.error('Dispatch failed after the order was marked ready', {
          orderId,
          error: error instanceof Error ? error.message : String(error),
        });

        return { dispatch: { deliveryId: null, created: false, needsManualAssignment: true } };
      }
    },
  });
}
