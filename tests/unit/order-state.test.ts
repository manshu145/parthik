import { describe, expect, it } from 'vitest';
import { StateTransitionError } from '@/lib/errors';
import {
  ACTIVE_STATUSES,
  allowedTransitionsFor,
  canTransition,
  findTransition,
  isTerminal,
  ORDER_TRANSITIONS,
  requireTransition,
  STATUS_TIMESTAMP_COLUMN,
  STOCK_RESERVED_STATUSES,
  TERMINAL_STATUSES,
  type OrderStatus,
  type TransitionActor,
} from '@/modules/order/order.state';

/**
 * Order state machine tests.
 *
 * This table is the spine of the commerce path: it decides who may move money, when stock
 * is freed, and when a refund becomes payable. So the tests are weighted toward what must
 * be IMPOSSIBLE — a permissive state machine does not fail loudly, it silently lets an
 * order be delivered twice or cancelled after the cash was collected.
 */

const ALL_STATUSES = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];
const ALL_ACTORS: TransitionActor[] = ['CUSTOMER', 'VENDOR', 'DRIVER', 'ADMIN', 'SYSTEM'];

describe('table integrity', () => {
  it('covers every status in the enum', () => {
    // A status missing from the table would throw on any attempt to move an order in it,
    // which would strand real orders.
    expect(ALL_STATUSES).toHaveLength(14);
  });

  it('only ever targets a known status', () => {
    for (const [from, rules] of Object.entries(ORDER_TRANSITIONS)) {
      for (const rule of rules) {
        expect(ALL_STATUSES, `${from} -> ${rule.to}`).toContain(rule.to);
      }
    }
  });

  it('never lists the same target twice from one status', () => {
    // Two rules for the same target would make the effects ambiguous — whichever matched
    // first would win, which is not a decision anyone made.
    for (const [from, rules] of Object.entries(ORDER_TRANSITIONS)) {
      const targets = rules.map((rule) => rule.to);
      expect(new Set(targets).size, `duplicate target from ${from}`).toBe(targets.length);
    }
  });

  it('gives every transition at least one permitted actor', () => {
    for (const [from, rules] of Object.entries(ORDER_TRANSITIONS)) {
      for (const rule of rules) {
        expect(rule.actors.length, `${from} -> ${rule.to} has no actors`).toBeGreaterThan(0);
      }
    }
  });

  it('never both releases and consumes stock in one transition', () => {
    // Stock is either returned to the shelf or converted to a sale. Both would double-count
    // it, and no type can catch that — so it is asserted.
    for (const rules of Object.values(ORDER_TRANSITIONS)) {
      for (const rule of rules) {
        const releases = rule.effects.includes('RELEASE_STOCK');
        const consumes = rule.effects.includes('CONSUME_STOCK');
        expect(releases && consumes).toBe(false);
      }
    }
  });

  it('never leaves a status unreachable except the entry points', () => {
    const reachable = new Set<string>();
    for (const rules of Object.values(ORDER_TRANSITIONS)) {
      for (const rule of rules) reachable.add(rule.to);
    }

    // PENDING_PAYMENT and CONFIRMED are the two documented entry points (D-12), so they
    // need no inbound transition. Everything else must be reachable or it is dead code.
    const unreachable = ALL_STATUSES.filter((status) => !reachable.has(status));
    expect(unreachable.sort()).toEqual(['PENDING_PAYMENT']);
  });
});

describe('terminal states', () => {
  it.each(TERMINAL_STATUSES)('%s has no outgoing transitions', (status) => {
    expect(ORDER_TRANSITIONS[status]).toEqual([]);
    expect(isTerminal(status)).toBe(true);
  });

  it.each(TERMINAL_STATUSES)('%s cannot be moved by anyone', (status) => {
    for (const target of ALL_STATUSES) {
      for (const actor of ALL_ACTORS) {
        expect(canTransition(status, target, actor), `${status} -> ${target} by ${actor}`).toBe(
          false
        );
      }
    }
  });

  it('does not treat DELIVERED as terminal', () => {
    // Returns and refunds still have to be possible after delivery.
    expect(isTerminal('DELIVERED')).toBe(false);
  });
});

describe('payment trust boundary', () => {
  it('lets only SYSTEM confirm a prepaid order', () => {
    // Master spec §22: the verified webhook is the only trusted source of payment truth.
    // A customer whose browser says "paid" is not evidence.
    expect(canTransition('PENDING_PAYMENT', 'CONFIRMED', 'SYSTEM')).toBe(true);

    for (const actor of ['CUSTOMER', 'VENDOR', 'DRIVER', 'ADMIN'] as TransitionActor[]) {
      expect(canTransition('PENDING_PAYMENT', 'CONFIRMED', actor), actor).toBe(false);
    }
  });

  it('lets a customer abandon an unpaid order', () => {
    expect(canTransition('PENDING_PAYMENT', 'CANCELLED', 'CUSTOMER')).toBe(true);
  });

  it('releases stock and the coupon when payment fails', () => {
    const rule = findTransition('PENDING_PAYMENT', 'PAYMENT_FAILED');

    // Holding stock behind a failed payment strangles availability for everyone else (D-16).
    expect(rule?.effects).toContain('RELEASE_STOCK');
    expect(rule?.effects).toContain('RELEASE_COUPON');
  });

  it('allows recovery from PAYMENT_FAILED', () => {
    // A retried payment must be able to confirm the order rather than forcing a new one.
    expect(canTransition('PAYMENT_FAILED', 'CONFIRMED', 'SYSTEM')).toBe(true);
  });
});

describe('stock effects', () => {
  it('consumes stock on exactly one transition', () => {
    const consuming: string[] = [];

    for (const [from, rules] of Object.entries(ORDER_TRANSITIONS)) {
      for (const rule of rules) {
        if (rule.effects.includes('CONSUME_STOCK')) consuming.push(`${from} -> ${rule.to}`);
      }
    }

    // Reservation becomes a sale on delivery and nowhere else (D-16).
    expect(consuming).toEqual(['OUT_FOR_DELIVERY -> DELIVERED']);
  });

  it('releases stock on every cancellation from a reserved status', () => {
    for (const status of STOCK_RESERVED_STATUSES) {
      const rule = findTransition(status, 'CANCELLED');
      if (!rule) continue;

      expect(rule.effects, `${status} -> CANCELLED must release stock`).toContain('RELEASE_STOCK');
    }
  });

  it('does not release stock when a driver merely drops the job', () => {
    // The customer's order is still valid; it goes back to the dispatch pool.
    const rule = findTransition('ASSIGNED', 'READY_FOR_PICKUP');

    expect(rule?.effects).not.toContain('RELEASE_STOCK');
    expect(rule?.effects).toContain('REQUEST_DISPATCH');
  });

  it('releases stock on a return, but does not release the coupon', () => {
    // The coupon was legitimately used on a delivered order; returning goods does not undo
    // that. The refund is handled separately.
    const rule = findTransition('DELIVERED', 'RETURNED');

    expect(rule?.effects).toContain('RELEASE_STOCK');
    expect(rule?.effects).not.toContain('RELEASE_COUPON');
  });
});

describe('COD collection', () => {
  it('collects cash only on delivery', () => {
    const collecting: string[] = [];

    for (const [from, rules] of Object.entries(ORDER_TRANSITIONS)) {
      for (const rule of rules) {
        if (rule.effects.includes('COLLECT_COD')) collecting.push(`${from} -> ${rule.to}`);
      }
    }

    // Cash is recorded and the payment marked PAID in the same transaction, so the two can
    // never diverge (docs/ARCHITECTURE.md §11.2.1).
    expect(collecting).toEqual(['OUT_FOR_DELIVERY -> DELIVERED']);
  });
});

describe('dispatch', () => {
  it('requests dispatch when the order is ready, not when it is accepted', () => {
    // Offering a delivery before the goods exist wastes the offer window and the driver's
    // time (D-18).
    expect(findTransition('PREPARING', 'READY_FOR_PICKUP')?.effects).toContain('REQUEST_DISPATCH');
    expect(findTransition('CONFIRMED', 'ACCEPTED')?.effects).not.toContain('REQUEST_DISPATCH');
  });

  it('lets only SYSTEM or ADMIN assign a driver', () => {
    expect(canTransition('READY_FOR_PICKUP', 'ASSIGNED', 'SYSTEM')).toBe(true);
    expect(canTransition('READY_FOR_PICKUP', 'ASSIGNED', 'ADMIN')).toBe(true);
    expect(canTransition('READY_FOR_PICKUP', 'ASSIGNED', 'DRIVER')).toBe(false);
    expect(canTransition('READY_FOR_PICKUP', 'ASSIGNED', 'VENDOR')).toBe(false);
  });
});

describe('who may cancel', () => {
  it('lets a customer cancel only before the vendor accepts', () => {
    // The conservative seed in docs/DATABASE.md §6.3: beyond ACCEPTED the vendor has begun
    // work, and D-19a values are still unset.
    expect(canTransition('CONFIRMED', 'CANCELLED', 'CUSTOMER')).toBe(true);

    for (const status of ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED'] as const) {
      expect(canTransition(status, 'CANCELLED', 'CUSTOMER'), status).toBe(false);
    }
  });

  it('never lets a customer cancel an order in flight', () => {
    for (const status of ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const) {
      expect(canTransition(status, 'CANCELLED', 'CUSTOMER'), status).toBe(false);
    }
  });

  it('never lets a vendor cancel once a driver holds the order', () => {
    for (const status of ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'] as const) {
      expect(canTransition(status, 'CANCELLED', 'VENDOR'), status).toBe(false);
    }
  });

  it('never lets a driver cancel an order at all', () => {
    // A driver drops a job (back to READY_FOR_PICKUP) or fails a delivery. Cancelling the
    // customer's order is not theirs to do.
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, 'CANCELLED', 'DRIVER'), status).toBe(false);
    }
  });

  it('requires a reason for every cancellation after CONFIRMED', () => {
    for (const status of ALL_STATUSES) {
      const rule = findTransition(status, 'CANCELLED');
      if (!rule || status === 'PENDING_PAYMENT' || status === 'PAYMENT_FAILED') continue;

      expect(rule.requiresReason, `${status} -> CANCELLED`).toBe(true);
    }
  });

  it('makes a refund due on every cancellation from a confirmed status', () => {
    for (const status of ['CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'] as const) {
      expect(findTransition(status, 'CANCELLED')?.effects, status).toContain('REFUND_DUE');
    }
  });
});

describe('post-delivery is admin only', () => {
  it.each(['RETURNED', 'REFUNDED'] as const)('only ADMIN may move DELIVERED -> %s', (target) => {
    expect(canTransition('DELIVERED', target, 'ADMIN')).toBe(true);

    for (const actor of ['CUSTOMER', 'VENDOR', 'DRIVER', 'SYSTEM'] as TransitionActor[]) {
      expect(canTransition('DELIVERED', target, actor), actor).toBe(false);
    }
  });

  it('cannot un-deliver an order', () => {
    for (const target of ACTIVE_STATUSES) {
      for (const actor of ALL_ACTORS) {
        expect(canTransition('DELIVERED', target, actor), `${target} by ${actor}`).toBe(false);
      }
    }
  });

  it('cannot cancel a delivered order', () => {
    // Once goods are handed over the remedy is a return or a refund, not a cancellation —
    // cancelling would release stock that is no longer on the shelf.
    for (const actor of ALL_ACTORS) {
      expect(canTransition('DELIVERED', 'CANCELLED', actor), actor).toBe(false);
    }
  });
});

describe('requireTransition', () => {
  it('returns the rule for a legal transition', () => {
    expect(requireTransition('CONFIRMED', 'ACCEPTED', 'VENDOR').to).toBe('ACCEPTED');
  });

  it('throws StateTransitionError for an impossible transition', () => {
    expect(() => requireTransition('DELIVERED', 'PREPARING', 'ADMIN')).toThrow(
      StateTransitionError
    );
  });

  it('distinguishes a forbidden actor from an impossible transition', () => {
    // Collapsing these would make a permission problem look like a state-machine bug and
    // send an operator chasing the wrong thing.
    const impossible = captureMessage(() => requireTransition('DELIVERED', 'PREPARING', 'ADMIN'));
    const forbidden = captureMessage(() => requireTransition('CONFIRMED', 'ACCEPTED', 'CUSTOMER'));

    expect(impossible).toMatch(/cannot move from CONFIRMED|cannot move from DELIVERED/);
    expect(forbidden).toMatch(/A CUSTOMER cannot/);
  });

  it('carries the statuses in details so the client can react', () => {
    try {
      requireTransition('DELIVERED', 'PREPARING', 'ADMIN');
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(StateTransitionError);
      expect((error as StateTransitionError).details).toEqual({
        from: 'DELIVERED',
        to: 'PREPARING',
      });
    }
  });

  it('reports INVALID_STATUS_TRANSITION as the error code', () => {
    try {
      requireTransition('REFUNDED', 'CONFIRMED', 'ADMIN');
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as StateTransitionError).code).toBe('INVALID_STATUS_TRANSITION');
      expect((error as StateTransitionError).status).toBe(409);
    }
  });
});

describe('allowedTransitionsFor', () => {
  it('lists only what the actor may actually do', () => {
    const vendor = allowedTransitionsFor('CONFIRMED', 'VENDOR').map((rule) => rule.to);
    expect(vendor.sort()).toEqual(['ACCEPTED', 'CANCELLED']);

    const customer = allowedTransitionsFor('CONFIRMED', 'CUSTOMER').map((rule) => rule.to);
    expect(customer).toEqual(['CANCELLED']);
  });

  it('returns nothing for a terminal status', () => {
    expect(allowedTransitionsFor('REFUNDED', 'ADMIN')).toEqual([]);
  });

  it('returns nothing for a driver on a vendor-only status', () => {
    expect(allowedTransitionsFor('CONFIRMED', 'DRIVER')).toEqual([]);
  });
});

describe('status timestamps', () => {
  it('stamps a time for each milestone status', () => {
    // These drive SLA reporting and delivery-duration metrics; a silently unset one shows
    // up as a gap in a report nobody then trusts.
    expect(STATUS_TIMESTAMP_COLUMN.CONFIRMED).toBe('confirmedAt');
    expect(STATUS_TIMESTAMP_COLUMN.ACCEPTED).toBe('acceptedAt');
    expect(STATUS_TIMESTAMP_COLUMN.READY_FOR_PICKUP).toBe('readyAt');
    expect(STATUS_TIMESTAMP_COLUMN.DELIVERED).toBe('deliveredAt');
    expect(STATUS_TIMESTAMP_COLUMN.CANCELLED).toBe('cancelledAt');
  });

  it('names only real order columns', () => {
    const columns = ['confirmedAt', 'acceptedAt', 'readyAt', 'deliveredAt', 'cancelledAt'];
    for (const value of Object.values(STATUS_TIMESTAMP_COLUMN)) {
      expect(columns).toContain(value);
    }
  });
});

describe('status groupings', () => {
  it('treats every reserved status as one where stock can still be released', () => {
    for (const status of STOCK_RESERVED_STATUSES) {
      expect(isTerminal(status)).toBe(false);
    }
    expect(STOCK_RESERVED_STATUSES).not.toContain('DELIVERED');
    expect(STOCK_RESERVED_STATUSES).not.toContain('CANCELLED');
  });

  it('excludes settled statuses from the active tracker set', () => {
    for (const settled of ['DELIVERED', 'CANCELLED', 'REFUNDED', 'RETURNED', 'PAYMENT_FAILED']) {
      expect(ACTIVE_STATUSES).not.toContain(settled as OrderStatus);
    }
  });

  it('excludes PENDING_PAYMENT from active tracking', () => {
    // Nothing operational is happening yet; the customer is still in the gateway.
    expect(ACTIVE_STATUSES).not.toContain('PENDING_PAYMENT');
  });
});

function captureMessage(run: () => unknown): string {
  try {
    run();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
