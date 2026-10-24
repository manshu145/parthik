import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { ConfigurationError } from '@/lib/errors';
import { getCheckoutService } from '@/modules/checkout';
import { DrizzleOrderRepository } from './order.repository';
import { OrderService } from './order.service';

/**
 * Order module composition root.
 *
 * NO IN-MEMORY BACKEND, deliberately, and this is the one module where that is the point.
 *
 * Every other module offers a memory fixture so a fresh clone works without credentials. An
 * order, though, is a financial record: it reserves stock, records a payment obligation and
 * is the thing a customer disputes months later. A version of it that evaporates on deploy
 * would let someone "place an order" in a preview environment, see a confirmation number,
 * and have nothing exist — which is worse than a clear failure. So this requires a real
 * database and says so.
 */
export async function getOrderService(): Promise<OrderService> {
  if (!isDatabaseConfigured()) {
    throw new ConfigurationError(
      'Orders require a database. Set DATABASE_URL — there is deliberately no in-memory order backend, because an order that disappears on restart is worse than one that was never placed.'
    );
  }

  const [db, checkout] = await Promise.all([getDb(), getCheckoutService()]);

  return new OrderService({
    repository: new DrizzleOrderRepository({ db }),
    checkout,
  });
}

/** Whether the order surface can function at all in this environment. */
export function isOrderingAvailable(): boolean {
  return isDatabaseConfigured();
}

export { OrderService, createOrderService } from './order.service';
export type { OrderServiceDeps, PlaceOrderInput, PlaceOrderResult } from './order.service';
export { DrizzleOrderRepository, createOrderRepository } from './order.repository';
/**
 * Low-level transition primitive, for a module that must move an order inside ITS OWN
 * transaction (the payment webhook, which has to confirm an order and mark its payment paid
 * atomically). Re-exported here because a repository may not import another module's
 * repository. Anything that does not need to share a transaction uses `OrderService.transition`,
 * which validates the move as well as performing it.
 */
export { applyOrderTransitionInTx } from './order.repository';
export {
  ACTIVE_STATUSES,
  allowedTransitionsFor,
  canTransition,
  findTransition,
  isTerminal,
  ORDER_TRANSITIONS,
  requireTransition,
  STOCK_RESERVED_STATUSES,
  TERMINAL_STATUSES,
} from './order.state';
export type { OrderStatus, TransitionActor, TransitionEffect, TransitionRule } from './order.state';
export {
  canCancel,
  evaluateCancellation,
  CONSERVATIVE_CANCELLATION_POLICIES,
} from './cancellation.policy';
export type {
  CancellationActor,
  CancellationDecision,
  CancellationPolicy,
} from './cancellation.policy';
export {
  cancelOrderBodySchema,
  idempotencyKeySchema,
  orderIdParamSchema,
  orderListQuerySchema,
  placeOrderBodySchema,
  transitionBodySchema,
} from './order.schema';
export type {
  OrderDetail,
  OrderLineRecord,
  OrderListItem,
  OrderRecord,
  OrderRepository,
  OrderStatusEvent,
} from './order.repository.types';
