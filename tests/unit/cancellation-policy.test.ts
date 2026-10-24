import { describe, expect, it } from 'vitest';
import {
  CONSERVATIVE_CANCELLATION_POLICIES,
  canCancel,
  evaluateCancellation,
  type CancellationActor,
  type CancellationPolicy,
  type EvaluateInput,
} from '@/modules/order/cancellation.policy';
import { ORDER_TRANSITIONS, type OrderStatus } from '@/modules/order/order.state';

/**
 * Cancellation policy tests.
 *
 * The engine decides who gets money back and how much, so these tests are weighted almost
 * entirely toward what must be REFUSED. A permissive cancellation engine does not fail
 * loudly — it quietly refunds an order that was already delivered, and nobody notices until
 * the month's payouts do not reconcile.
 *
 * 🔴 D-19a is blocked, so the shipped table is deliberately tiny. The tests assert that it
 * STAYS tiny: if someone adds a plausible-looking 50% window while the commercial answer is
 * still outstanding, the parity test below fails rather than the customer finding out.
 */

const ALL_STATUSES = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];
const ACTORS: CancellationActor[] = ['CUSTOMER', 'VENDOR', 'ADMIN'];

const PLACED_AT = new Date('2026-03-01T10:00:00.000Z');

function input(overrides: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    actor: 'CUSTOMER',
    status: 'CONFIRMED',
    isCod: true,
    placedAt: PLACED_AT,
    itemValuePaise: 50_000,
    deliveryFeePaise: 2_500,
    now: new Date(PLACED_AT.getTime() + 60_000),
    ...overrides,
  };
}

describe('fails closed', () => {
  it('refuses every actor/status pair the table does not name', () => {
    const named = new Set(
      CONSERVATIVE_CANCELLATION_POLICIES.map((policy) => `${policy.actorRole}:${policy.fromStatus}`)
    );

    for (const actor of ACTORS) {
      for (const status of ALL_STATUSES) {
        const decision = evaluateCancellation(input({ actor, status }));
        const isNamed = named.has(`${actor}:${status}`);

        expect(decision.isAllowed, `${actor} @ ${status}`).toBe(isNamed);
        if (!isNamed) {
          expect(decision.reason, `${actor} @ ${status}`).toBe('NO_POLICY');
        }
      }
    }
  });

  it('refuses with a zero refund, never a partial one', () => {
    // A refused decision that still carried a percentage would be a trap: a caller reading
    // refundAmountPaise without checking isAllowed would refund on a refusal.
    const decision = evaluateCancellation(input({ status: 'DELIVERED' }));

    expect(decision.isAllowed).toBe(false);
    expect(decision.refundPercent).toBe(0);
    expect(decision.refundAmountPaise).toBe(0);
    expect(decision.refundDeliveryFee).toBe(false);
    expect(decision.restock).toBe(false);
    expect(decision.compensateDriver).toBe(false);
  });

  it('refuses a customer cancelling a delivered order', () => {
    expect(canCancel(input({ status: 'DELIVERED' }))).toBe(false);
  });

  it('refuses a customer cancelling once a driver holds the order', () => {
    for (const status of ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'] as const) {
      expect(canCancel(input({ status })), status).toBe(false);
    }
  });

  it('refuses an already terminal order', () => {
    for (const status of ['CANCELLED', 'DELIVERED', 'REFUNDED', 'RETURNED'] as const) {
      for (const actor of ACTORS) {
        expect(canCancel(input({ actor, status })), `${actor} @ ${status}`).toBe(false);
      }
    }
  });

  it('refuses an empty policy table outright', () => {
    // Guards the wiring as much as the engine: an empty table read from the database must
    // block cancellations rather than allow everything.
    const decision = evaluateCancellation(input(), []);
    expect(decision.isAllowed).toBe(false);
    expect(decision.reason).toBe('NO_POLICY');
  });
});

describe('the conservative table only ships what D-19a already answers', () => {
  it('invents no partial refund percentage', () => {
    // The ONE assertion that matters while D-19a is open. Every shipped rule refunds in
    // full, because a partial percentage is a commercial decision nobody has made.
    for (const policy of CONSERVATIVE_CANCELLATION_POLICIES) {
      expect(policy.refundPercent, `${policy.actorRole} @ ${policy.fromStatus}`).toBe(100);
    }
  });

  it('invents no cancellation window', () => {
    for (const policy of CONSERVATIVE_CANCELLATION_POLICIES) {
      expect(policy.windowMinutes, `${policy.actorRole} @ ${policy.fromStatus}`).toBeNull();
    }
  });

  it('promises no driver compensation', () => {
    // Whether a dispatched driver is paid for a cancelled trip is part of D-19a. Shipping
    // `true` would create a payout obligation the platform never agreed to.
    for (const policy of CONSERVATIVE_CANCELLATION_POLICIES) {
      expect(policy.compensateDriver).toBe(false);
    }
  });

  it('restocks on every permitted cancellation', () => {
    // The inverse would strand inventory: an order cancelled without restocking holds units
    // that no longer belong to anyone.
    for (const policy of CONSERVATIVE_CANCELLATION_POLICIES) {
      expect(policy.restock).toBe(true);
    }
  });

  it('lets a customer cancel only before the vendor has accepted', () => {
    const customerStatuses = CONSERVATIVE_CANCELLATION_POLICIES.filter(
      (policy) => policy.actorRole === 'CUSTOMER'
    ).map((policy) => policy.fromStatus);

    expect(new Set(customerStatuses)).toEqual(new Set(['CONFIRMED', 'PENDING_PAYMENT']));
  });

  it('lets an admin cancel at any pre-delivery status', () => {
    const adminStatuses = CONSERVATIVE_CANCELLATION_POLICIES.filter(
      (policy) => policy.actorRole === 'ADMIN'
    ).map((policy) => policy.fromStatus);

    expect(new Set(adminStatuses)).toEqual(
      new Set([
        'PENDING_PAYMENT',
        'CONFIRMED',
        'ACCEPTED',
        'PREPARING',
        'READY_FOR_PICKUP',
        'ASSIGNED',
      ])
    );
  });

  it('demands a reason from staff but not from the customer', () => {
    for (const policy of CONSERVATIVE_CANCELLATION_POLICIES) {
      const expected = policy.actorRole !== 'CUSTOMER';
      expect(policy.requiresReason, `${policy.actorRole} @ ${policy.fromStatus}`).toBe(expected);
    }
  });

  it('names only statuses the state machine can actually reach', () => {
    for (const policy of CONSERVATIVE_CANCELLATION_POLICIES) {
      expect(ALL_STATUSES).toContain(policy.fromStatus);
    }
  });

  it('can always be carried out by the state machine', () => {
    // A policy permitting a cancellation the transition table forbids would surface as a 409
    // AFTER the customer was told the cancellation was allowed.
    for (const policy of CONSERVATIVE_CANCELLATION_POLICIES) {
      const rules = ORDER_TRANSITIONS[policy.fromStatus];
      const cancel = rules.find((rule) => rule.to === 'CANCELLED');

      expect(cancel, `no CANCELLED transition from ${policy.fromStatus}`).toBeDefined();
      expect(
        cancel?.actors,
        `${policy.actorRole} cannot cancel from ${policy.fromStatus}`
      ).toContain(policy.actorRole);
    }
  });
});

describe('refund arithmetic', () => {
  it('refunds the item value plus the delivery fee when the policy says so', () => {
    const decision = evaluateCancellation(
      input({ itemValuePaise: 50_000, deliveryFeePaise: 2_500 })
    );

    expect(decision.isAllowed).toBe(true);
    expect(decision.refundAmountPaise).toBe(52_500);
  });

  it('excludes the delivery fee when the policy withholds it', () => {
    const policy = withPolicy({ refundDeliveryFee: false });
    const decision = evaluateCancellation(input(), [policy]);

    expect(decision.refundAmountPaise).toBe(50_000);
    expect(decision.refundDeliveryFee).toBe(false);
  });

  it('rounds a partial refund DOWN to the paisa', () => {
    // 33% of 1,001 paise is 330.33. Rounding up would refund a paisa more than the rule
    // allows on every single order, which is a real cost at volume and impossible to
    // reconcile against a percentage.
    const policy = withPolicy({ refundPercent: 33, refundDeliveryFee: false });
    const decision = evaluateCancellation(input({ itemValuePaise: 1_001 }), [policy]);

    expect(decision.refundAmountPaise).toBe(330);
  });

  it('never returns a fractional paisa', () => {
    const policy = withPolicy({ refundPercent: 37, refundDeliveryFee: true });

    for (const value of [1, 7, 99, 12_345, 999_999]) {
      const decision = evaluateCancellation(input({ itemValuePaise: value }), [policy]);
      expect(Number.isInteger(decision.refundAmountPaise), `value ${value}`).toBe(true);
    }
  });

  it('refunds nothing at 0% but still permits the cancellation', () => {
    // A no-refund cancellation is a legitimate rule, and it is NOT the same as a refusal.
    const policy = withPolicy({ refundPercent: 0, refundDeliveryFee: false });
    const decision = evaluateCancellation(input(), [policy]);

    expect(decision.isAllowed).toBe(true);
    expect(decision.refundAmountPaise).toBe(0);
  });
});

describe('windows', () => {
  const windowed = withPolicy({ windowMinutes: 30 });

  it('permits a cancellation inside the window', () => {
    const decision = evaluateCancellation(
      input({ now: new Date(PLACED_AT.getTime() + 29 * 60_000) }),
      [windowed]
    );
    expect(decision.isAllowed).toBe(true);
  });

  it('permits a cancellation exactly on the boundary', () => {
    // Boundary in the customer's favour: at exactly 30 minutes the window is not yet past.
    const decision = evaluateCancellation(
      input({ now: new Date(PLACED_AT.getTime() + 30 * 60_000) }),
      [windowed]
    );
    expect(decision.isAllowed).toBe(true);
  });

  it('refuses a second past the window', () => {
    const decision = evaluateCancellation(
      input({ now: new Date(PLACED_AT.getTime() + 30 * 60_000 + 1_000) }),
      [windowed]
    );

    expect(decision.isAllowed).toBe(false);
    expect(decision.reason).toBe('WINDOW_EXPIRED');
  });

  it('distinguishes an expired window from a missing policy', () => {
    // The UI says different things: "the window has passed" is actionable through support,
    // "you cannot cancel this" is not.
    const expired = evaluateCancellation(
      input({ now: new Date(PLACED_AT.getTime() + 60 * 60_000) }),
      [windowed]
    );
    const missing = evaluateCancellation(input({ status: 'DELIVERED' }), [windowed]);

    expect(expired.reason).toBe('WINDOW_EXPIRED');
    expect(missing.reason).toBe('NO_POLICY');
  });

  it('ignores the clock when the window is null', () => {
    const decision = evaluateCancellation(
      input({ now: new Date(PLACED_AT.getTime() + 400 * 24 * 60 * 60_000) })
    );
    expect(decision.isAllowed).toBe(true);
  });
});

describe('resolution order', () => {
  it('prefers a payment-method rule over a catch-all', () => {
    // Without specificity ordering a COD-specific rule could be shadowed by an `ALL` one,
    // which is exactly how a COD order ends up promised a prepaid refund.
    const decision = evaluateCancellation(input({ isCod: true }), [
      withPolicy({ paymentMethodScope: 'ALL', refundPercent: 100 }),
      withPolicy({ paymentMethodScope: 'COD', refundPercent: 40, refundDeliveryFee: false }),
    ]);

    expect(decision.refundPercent).toBe(40);
  });

  it('ignores a rule scoped to the other payment method', () => {
    const decision = evaluateCancellation(input({ isCod: false }), [
      withPolicy({ paymentMethodScope: 'COD', refundPercent: 40 }),
    ]);

    expect(decision.isAllowed).toBe(false);
    expect(decision.reason).toBe('NO_POLICY');
  });

  it('treats a prepaid order as PREPAID scope', () => {
    const decision = evaluateCancellation(input({ isCod: false }), [
      withPolicy({ paymentMethodScope: 'PREPAID', refundPercent: 60, refundDeliveryFee: false }),
    ]);

    expect(decision.refundPercent).toBe(60);
  });

  it('breaks a tie on priority, highest first', () => {
    const decision = evaluateCancellation(input(), [
      withPolicy({ priority: 1, refundPercent: 25, refundDeliveryFee: false }),
      withPolicy({ priority: 9, refundPercent: 75, refundDeliveryFee: false }),
    ]);

    expect(decision.refundPercent).toBe(75);
  });

  it('honours an explicit isAllowed:false override', () => {
    // A row that exists to FORBID is different from no row at all, and the reason says so.
    const decision = evaluateCancellation(input(), [withPolicy({ isAllowed: false })]);

    expect(decision.isAllowed).toBe(false);
    expect(decision.reason).toBe('NOT_PERMITTED');
  });

  it('lets a forbidding rule beat a permitting one on priority', () => {
    const decision = evaluateCancellation(input(), [
      withPolicy({ isAllowed: true, priority: 0 }),
      withPolicy({ isAllowed: false, priority: 5 }),
    ]);

    expect(decision.isAllowed).toBe(false);
    expect(decision.reason).toBe('NOT_PERMITTED');
  });
});

describe('canCancel', () => {
  it('agrees with evaluateCancellation on every actor and status', () => {
    // canCancel exists only to render a button. If it ever disagreed, the UI would show a
    // button that fails on click — or hide one that would have worked.
    for (const actor of ACTORS) {
      for (const status of ALL_STATUSES) {
        const args = input({ actor, status });
        expect(canCancel(args), `${actor} @ ${status}`).toBe(evaluateCancellation(args).isAllowed);
      }
    }
  });
});

function withPolicy(overrides: Partial<CancellationPolicy> = {}): CancellationPolicy {
  return {
    actorRole: 'CUSTOMER',
    fromStatus: 'CONFIRMED',
    isAllowed: true,
    windowMinutes: null,
    refundPercent: 100,
    refundDeliveryFee: true,
    requiresReason: false,
    restock: true,
    compensateDriver: false,
    paymentMethodScope: 'ALL',
    priority: 0,
    ...overrides,
  };
}
