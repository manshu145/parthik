import { beforeEach, describe, expect, it } from 'vitest';
import { buildMockWebhook, MockPaymentProvider } from '@/lib/payments/mock-provider';
import type { ProviderPaymentSnapshot, ProviderRefundStatus } from '@/lib/payments/types';
import { PaymentService } from '@/modules/payment/payment.service';
import type {
  ApplyCaptureInput,
  ApplyFailureInput,
  CaptureOutcome,
  CreateRefundInput,
  FailureOutcome,
  PaymentRecord,
  PaymentRepository,
  PaymentWithOrder,
  RecordEventInput,
  RecordEventResult,
  RefundRecord,
} from '@/modules/payment/payment.repository.types';
import type { OrderStatus } from '@/modules/order';

/**
 * Payment service tests.
 *
 * The repository here is a FAKE, but a strict one: it enforces the replay guard, the amount
 * check, the "a failure after a capture does not undo the capture" rule and the refund ceiling,
 * because those are exactly the guarantees the service leans on. A fake that said yes to
 * everything would let a broken service pass, which for this module means letting an order
 * confirm against a payment that never happened.
 *
 * The SQL behind these rules is verified separately against a real PostgreSQL container by
 * `scripts/check-payment-flow.sh` — a fake cannot tell you that a unique index actually rejects
 * a concurrent duplicate.
 */

const USER = 'user-pay-1';
const OTHER_USER = 'user-pay-2';
const ORDER_ID = '11111111-1111-7111-8111-111111111111';
const PAYMENT_ID = '22222222-2222-7222-8222-222222222222';

interface FakeState {
  payment: PaymentRecord;
  order: PaymentWithOrder['order'];
}

class FakePaymentRepository implements PaymentRepository {
  readonly events: Array<
    RecordEventInput & { id: string; processedAt: Date | null; error: string | null }
  > = [];
  readonly refunds: RefundRecord[] = [];
  readonly captureCalls: ApplyCaptureInput[] = [];

  private state: FakeState;
  private sequence = 0;

  constructor(
    overrides: { payment?: Partial<PaymentRecord>; order?: Partial<FakeState['order']> } = {}
  ) {
    this.state = {
      payment: {
        id: PAYMENT_ID,
        orderId: ORDER_ID,
        provider: 'mock',
        providerPaymentId: null,
        providerOrderId: null,
        method: 'UPI',
        amountPaise: 45_900,
        currency: 'INR',
        status: 'CREATED',
        idempotencyKey: 'web-key-1:payment',
        failureCode: null,
        failureMessage: null,
        authorizedAt: null,
        paidAt: null,
        failedAt: null,
        reconciledAt: null,
        createdAt: new Date('2026-03-01T10:00:00Z'),
        ...overrides.payment,
      },
      order: {
        id: ORDER_ID,
        orderNumber: 'PK-2026-000001',
        userId: USER,
        status: 'PENDING_PAYMENT',
        totalAmountPaise: 45_900,
        isCod: false,
        paymentStatus: 'CREATED',
        ...overrides.order,
      },
    };
  }

  snapshot(): FakeState {
    return { payment: { ...this.state.payment }, order: { ...this.state.order } };
  }

  private wrap(): PaymentWithOrder {
    return { payment: { ...this.state.payment }, order: { ...this.state.order } };
  }

  async findForOrder(orderId: string): Promise<PaymentWithOrder | null> {
    return orderId === this.state.order.id ? this.wrap() : null;
  }

  async findById(paymentId: string): Promise<PaymentWithOrder | null> {
    return paymentId === this.state.payment.id ? this.wrap() : null;
  }

  async findForUser(userId: string, paymentId: string): Promise<PaymentWithOrder | null> {
    // Ownership is part of the lookup, exactly as the SQL scopes it.
    return paymentId === this.state.payment.id && userId === this.state.order.userId
      ? this.wrap()
      : null;
  }

  async findByProviderOrderId(providerOrderId: string): Promise<PaymentWithOrder | null> {
    return providerOrderId === this.state.payment.providerOrderId ? this.wrap() : null;
  }

  async findByProviderPaymentId(providerPaymentId: string): Promise<PaymentWithOrder | null> {
    return providerPaymentId === this.state.payment.providerPaymentId ? this.wrap() : null;
  }

  async attachIntent(input: {
    paymentId: string;
    providerOrderId: string;
  }): Promise<PaymentRecord> {
    if (this.state.payment.status === 'PAID') throw new Error('already settled');
    this.state.payment = {
      ...this.state.payment,
      providerOrderId: input.providerOrderId,
      status: 'PENDING',
    };
    return { ...this.state.payment };
  }

  async recordEvent(input: RecordEventInput): Promise<RecordEventResult> {
    const existing = this.events.find((event) => event.providerEventId === input.providerEventId);
    // The real guard is a unique index; reproducing it keeps the replay path honest.
    if (existing) return { ok: false, reason: 'DUPLICATE', eventId: existing.id };

    this.sequence += 1;
    const id = `event-${this.sequence}`;
    this.events.push({ ...input, id, processedAt: null, error: null });
    return { ok: true, eventId: id };
  }

  async markEventProcessed(eventId: string, error?: string | null): Promise<void> {
    const event = this.events.find((candidate) => candidate.id === eventId);
    if (event) {
      event.processedAt = new Date();
      event.error = error ?? null;
    }
  }

  async applyCapture(
    input: ApplyCaptureInput
  ): Promise<{ outcome: CaptureOutcome; orderId: string }> {
    this.captureCalls.push(input);

    if (this.state.payment.status === 'PAID') {
      await this.markEventProcessed(input.eventId ?? '', null);
      return { outcome: 'ALREADY_PAID', orderId: this.state.order.id };
    }

    if (this.state.payment.amountPaise !== input.amountPaise) {
      // Nothing is written. The service must report this, not confirm the order.
      await this.markEventProcessed(input.eventId ?? '', 'amount mismatch');
      return { outcome: 'AMOUNT_MISMATCH', orderId: this.state.order.id };
    }

    this.state.payment = {
      ...this.state.payment,
      status: 'PAID',
      providerPaymentId: input.providerPaymentId,
      paidAt: input.paidAt,
    };
    this.state.order = { ...this.state.order, paymentStatus: 'PAID' };

    if (this.state.order.status === 'PENDING_PAYMENT') {
      this.state.order = { ...this.state.order, status: 'CONFIRMED' as OrderStatus };
      await this.markEventProcessed(input.eventId ?? '', null);
      return { outcome: 'CONFIRMED', orderId: this.state.order.id };
    }

    const outcome: CaptureOutcome =
      this.state.order.status === 'CANCELLED' || this.state.order.status === 'PAYMENT_FAILED'
        ? 'PAID_AFTER_CANCELLATION'
        : 'PAID_WITHOUT_TRANSITION';

    await this.markEventProcessed(input.eventId ?? '', `order was ${this.state.order.status}`);
    return { outcome, orderId: this.state.order.id };
  }

  async applyFailure(
    input: ApplyFailureInput
  ): Promise<{ outcome: FailureOutcome; orderId: string }> {
    if (this.state.payment.status === 'PAID') {
      await this.markEventProcessed(input.eventId ?? '', 'payment already captured');
      return { outcome: 'ALREADY_PAID', orderId: this.state.order.id };
    }

    if (this.state.payment.status === 'FAILED') {
      return { outcome: 'ALREADY_FAILED', orderId: this.state.order.id };
    }

    this.state.payment = {
      ...this.state.payment,
      status: 'FAILED',
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      failedAt: new Date(),
    };
    this.state.order = { ...this.state.order, paymentStatus: 'FAILED' };

    if (this.state.order.status !== 'PENDING_PAYMENT') {
      return { outcome: 'NO_TRANSITION', orderId: this.state.order.id };
    }

    this.state.order = { ...this.state.order, status: 'PAYMENT_FAILED' as OrderStatus };
    await this.markEventProcessed(input.eventId ?? '', null);
    return { outcome: 'PAYMENT_FAILED', orderId: this.state.order.id };
  }

  async listStalePending(): Promise<PaymentWithOrder[]> {
    return ['CREATED', 'PENDING', 'AUTHORIZED'].includes(this.state.payment.status)
      ? [this.wrap()]
      : [];
  }

  async markReconciled(_paymentId: string, note: string): Promise<void> {
    this.state.payment = {
      ...this.state.payment,
      reconciledAt: new Date(),
      failureMessage: this.state.payment.failureMessage,
    };
    void note;
  }

  async refundedTotalPaise(): Promise<number> {
    return this.refunds
      .filter((refund) => refund.status !== 'FAILED')
      .reduce((sum, refund) => sum + refund.amountPaise, 0);
  }

  async createRefund(
    input: CreateRefundInput
  ): Promise<{ ok: true; refund: RefundRecord } | { ok: false; reason: 'EXCEEDS_PAYMENT' }> {
    const already = await this.refundedTotalPaise();
    // The ceiling lives in the repository in production too, so no caller can skip it.
    if (already + input.amountPaise > this.state.order.totalAmountPaise) {
      return { ok: false, reason: 'EXCEEDS_PAYMENT' };
    }

    this.sequence += 1;
    const refund: RefundRecord = {
      id: `refund-${this.sequence}`,
      orderId: input.orderId,
      paymentId: input.paymentId,
      providerRefundId: input.providerRefundId,
      amountPaise: input.amountPaise,
      status: input.status,
      refundType:
        already + input.amountPaise >= this.state.order.totalAmountPaise ? 'FULL' : 'PARTIAL',
      createdAt: new Date(),
    };

    this.refunds.push(refund);
    return { ok: true, refund };
  }

  async markRefundStatus(providerRefundId: string, status: ProviderRefundStatus): Promise<void> {
    const refund = this.refunds.find(
      (candidate) =>
        candidate.providerRefundId === providerRefundId || candidate.providerRefundId === null
    );
    if (refund) {
      refund.providerRefundId = providerRefundId;
      refund.status = status;
    }
  }
}

/** A provider whose answers a test can dictate, for the paths the mock cannot reach. */
class ScriptedProvider extends MockPaymentProvider {
  snapshotToReturn: ProviderPaymentSnapshot | null = null;
  fetchCalls: string[] = [];
  shouldThrowOnFetch = false;

  override async fetchPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentSnapshot> {
    this.fetchCalls.push(providerPaymentId);
    if (this.shouldThrowOnFetch) throw new Error('gateway unreachable');
    return this.snapshotToReturn ?? super.fetchPaymentStatus(providerPaymentId);
  }
}

function build(
  overrides: { payment?: Partial<PaymentRecord>; order?: Partial<PaymentWithOrder['order']> } = {}
) {
  const repository = new FakePaymentRepository(overrides);
  const provider = new ScriptedProvider();
  return { repository, provider, service: new PaymentService({ repository, provider }) };
}

async function capture(input: {
  providerOrderId?: string | undefined;
  providerPaymentId?: string;
  amountPaise?: number;
  eventId?: string;
  event?: 'payment.captured' | 'payment.failed' | 'payment.authorized' | 'refund.processed';
}) {
  return buildMockWebhook({
    event: input.event ?? 'payment.captured',
    providerPaymentId: input.providerPaymentId ?? 'pay_mock_paid_45900',
    providerOrderId: input.providerOrderId,
    amountPaise: input.amountPaise ?? 45_900,
    ...(input.eventId ? { eventId: input.eventId } : {}),
  });
}

let harness: ReturnType<typeof build>;

beforeEach(() => {
  harness = build();
});

describe('createIntent', () => {
  it('attaches the provider reference and returns a client payload', async () => {
    const { service, repository } = harness;
    const result = await service.createIntent({ userId: USER, orderId: ORDER_ID });

    expect(result.clientPayload.providerOrderId).toMatch(/^order_mock_/);
    expect(result.clientPayload.amountPaise).toBe(45_900);
    expect(repository.snapshot().payment.status).toBe('PENDING');
    expect(repository.snapshot().payment.providerOrderId).toBe(
      result.clientPayload.providerOrderId
    );
  });

  it('carries NO secret in the client payload', async () => {
    const { service } = harness;
    const { clientPayload } = await service.createIntent({ userId: USER, orderId: ORDER_ID });

    // The key id is public; anything resembling a secret must never reach the browser.
    expect(JSON.stringify(clientPayload)).not.toMatch(/secret/i);
    expect(clientPayload.keyId).toBe('rzp_test_mock');
  });

  it('returns the SAME provider order for a repeated attempt', async () => {
    const { service } = harness;
    const first = await service.createIntent({ userId: USER, orderId: ORDER_ID });
    const second = await service.createIntent({ userId: USER, orderId: ORDER_ID });

    // Keyed on the payment row's own idempotency key, so a customer who reloads the payment
    // page cannot end up with two payable intents for one order.
    expect(second.clientPayload.providerOrderId).toBe(first.clientPayload.providerOrderId);
  });

  it('answers NOT_FOUND for another customer', async () => {
    const { service } = harness;
    await expect(
      service.createIntent({ userId: OTHER_USER, orderId: ORDER_ID })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a COD order', async () => {
    const { service } = build({ order: { isCod: true, status: 'CONFIRMED' } });
    await expect(service.createIntent({ userId: USER, orderId: ORDER_ID })).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATED',
    });
  });

  it('refuses an order that is already paid', async () => {
    const { service } = build({ payment: { status: 'PAID' } });
    await expect(service.createIntent({ userId: USER, orderId: ORDER_ID })).rejects.toMatchObject({
      code: 'PAYMENT_ALREADY_CAPTURED',
    });
  });

  it('allows a retry after a failure — this is the recovery path', async () => {
    const { service } = build({
      payment: { status: 'FAILED', failureCode: 'BAD_REQUEST_ERROR' },
      order: { status: 'PAYMENT_FAILED' },
    });

    const result = await service.createIntent({ userId: USER, orderId: ORDER_ID });
    expect(result.clientPayload.providerOrderId).toMatch(/^order_mock_/);
  });

  it('refuses an order that has moved past payment', async () => {
    const { service } = build({ order: { status: 'DELIVERED' } });
    await expect(service.createIntent({ userId: USER, orderId: ORDER_ID })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('handleWebhook', () => {
  it('confirms the order on a verified capture', async () => {
    const { service, repository } = harness;
    const { clientPayload } = await service.createIntent({ userId: USER, orderId: ORDER_ID });

    const built = await capture({ providerOrderId: clientPayload.providerOrderId });
    const result = await service.handleWebhook({
      rawBody: built.rawBody,
      signature: built.signature,
      eventId: built.eventId,
    });

    expect(result).toMatchObject({ status: 'PROCESSED', outcome: 'CONFIRMED' });
    expect(repository.snapshot().payment.status).toBe('PAID');
    expect(repository.snapshot().order.status).toBe('CONFIRMED');
  });

  it('REJECTS an unsigned webhook and stores nothing', async () => {
    const { service, repository } = harness;
    const built = await capture({});

    const result = await service.handleWebhook({ rawBody: built.rawBody, signature: null });

    expect(result).toEqual({ status: 'REJECTED', reason: 'SIGNATURE_INVALID' });
    // Nothing parsed, nothing written: an unauthenticated endpoint must not store caller JSON.
    expect(repository.events).toHaveLength(0);
    expect(repository.snapshot().payment.status).toBe('CREATED');
  });

  it('rejects a tampered amount', async () => {
    const { service, repository } = harness;
    await service.createIntent({ userId: USER, orderId: ORDER_ID });

    const built = await capture({});
    const tampered = built.rawBody.replace('45900', '100');

    const result = await service.handleWebhook({ rawBody: tampered, signature: built.signature });

    expect(result).toEqual({ status: 'REJECTED', reason: 'SIGNATURE_INVALID' });
    expect(repository.snapshot().payment.status).toBe('PENDING');
  });

  it('treats a replayed delivery as a no-op, not a second capture', async () => {
    const { service, repository } = harness;
    const { clientPayload } = await service.createIntent({ userId: USER, orderId: ORDER_ID });
    const built = await capture({ providerOrderId: clientPayload.providerOrderId });

    const first = await service.handleWebhook({
      rawBody: built.rawBody,
      signature: built.signature,
      eventId: built.eventId,
    });
    const second = await service.handleWebhook({
      rawBody: built.rawBody,
      signature: built.signature,
      eventId: built.eventId,
    });

    expect(first.status).toBe('PROCESSED');
    expect(second).toEqual({ status: 'REPLAYED' });
    // The decisive assertion: the capture path ran exactly once.
    expect(repository.captureCalls).toHaveLength(1);
    expect(repository.events).toHaveLength(1);
  });

  it('does not confirm an order when the amount does not match', async () => {
    const { service, repository } = harness;
    const { clientPayload } = await service.createIntent({ userId: USER, orderId: ORDER_ID });

    // A correctly signed event for the wrong amount: a partial capture, or a compromised key.
    const built = await capture({
      providerOrderId: clientPayload.providerOrderId,
      amountPaise: 100,
    });

    const result = await service.handleWebhook({
      rawBody: built.rawBody,
      signature: built.signature,
      eventId: built.eventId,
    });

    expect(result).toMatchObject({ status: 'PROCESSED', outcome: 'AMOUNT_MISMATCH' });
    expect(repository.snapshot().payment.status).toBe('PENDING');
    expect(repository.snapshot().order.status).toBe('PENDING_PAYMENT');
  });

  it('releases the order on a verified failure', async () => {
    const { service, repository } = harness;
    const { clientPayload } = await service.createIntent({ userId: USER, orderId: ORDER_ID });

    const built = await capture({
      event: 'payment.failed',
      providerOrderId: clientPayload.providerOrderId,
      providerPaymentId: 'pay_mock_failed_45900',
    });

    const result = await service.handleWebhook({
      rawBody: built.rawBody,
      signature: built.signature,
      eventId: built.eventId,
    });

    expect(result).toMatchObject({ status: 'PROCESSED', outcome: 'PAYMENT_FAILED' });
    expect(repository.snapshot().order.status).toBe('PAYMENT_FAILED');
  });

  it('does NOT undo a capture when a late failure arrives', async () => {
    const { service, repository } = harness;
    const { clientPayload } = await service.createIntent({ userId: USER, orderId: ORDER_ID });

    const captured = await capture({ providerOrderId: clientPayload.providerOrderId });
    await service.handleWebhook({
      rawBody: captured.rawBody,
      signature: captured.signature,
      eventId: captured.eventId,
    });

    // Razorpay can report a failed earlier attempt after a later one succeeded. Treating it as
    // a failure would release stock for an order the customer has paid for.
    const failed = await capture({
      event: 'payment.failed',
      providerOrderId: clientPayload.providerOrderId,
      providerPaymentId: 'pay_mock_failed_45900',
      eventId: 'evt-late-failure',
    });

    const result = await service.handleWebhook({
      rawBody: failed.rawBody,
      signature: failed.signature,
      eventId: failed.eventId,
    });

    expect(result).toMatchObject({ status: 'PROCESSED', outcome: 'ALREADY_PAID' });
    expect(repository.snapshot().payment.status).toBe('PAID');
    expect(repository.snapshot().order.status).toBe('CONFIRMED');
  });

  it('records an AUTHORIZED payment without confirming the order', async () => {
    const { service, repository } = harness;
    const { clientPayload } = await service.createIntent({ userId: USER, orderId: ORDER_ID });

    const built = await capture({
      event: 'payment.authorized',
      providerOrderId: clientPayload.providerOrderId,
    });

    const result = await service.handleWebhook({
      rawBody: built.rawBody,
      signature: built.signature,
      eventId: built.eventId,
    });

    // Money held is not money taken. Shipping against an authorisation is how a sale ends up
    // uncollected.
    expect(result).toMatchObject({ outcome: 'AUTHORIZED_NOT_CAPTURED' });
    expect(repository.snapshot().order.status).toBe('PENDING_PAYMENT');
  });

  it('stores and ignores an event type it does not handle', async () => {
    const { service, repository } = harness;
    await service.createIntent({ userId: USER, orderId: ORDER_ID });

    const body = JSON.stringify({
      entity: 'event',
      event: 'payment.dispute.created',
      created_at: Math.floor(Date.now() / 1000),
      payload: { payment: { entity: { id: 'pay_x', amount: 45_900 } } },
    });
    const signature = await signMock(body);

    const result = await service.handleWebhook({
      rawBody: body,
      signature,
      eventId: 'evt-dispute',
    });

    expect(result).toMatchObject({ status: 'IGNORED' });
    // The log is worth keeping even when the meaning is not.
    expect(repository.events).toHaveLength(1);
  });

  it('accepts but does not act on a signed event for an unknown payment', async () => {
    const { service, repository } = harness;
    // No intent created, so nothing matches this provider order.
    const built = await capture({ providerOrderId: 'order_mock_unknown' });

    const result = await service.handleWebhook({
      rawBody: built.rawBody,
      signature: built.signature,
      eventId: built.eventId,
    });

    // Retrying will not help, so it is stored and accepted rather than 500'd forever.
    expect(result).toMatchObject({ status: 'UNPROCESSABLE' });
    expect(repository.events).toHaveLength(1);
    expect(repository.snapshot().payment.status).toBe('CREATED');
  });

  it('completes a refund on refund.processed', async () => {
    const { service, repository } = build({
      payment: { status: 'PAID', providerPaymentId: 'pay_1' },
    });
    await repository.createRefund({
      orderId: ORDER_ID,
      paymentId: PAYMENT_ID,
      amountPaise: 1_000,
      reason: 'test',
      initiatedBy: null,
      providerRefundId: 'rfnd_mock_pay_1',
      status: 'INITIATED',
      isManualPayout: false,
    });

    const built = await capture({
      event: 'refund.processed',
      providerPaymentId: 'pay_1',
      amountPaise: 1_000,
    });
    const result = await service.handleWebhook({
      rawBody: built.rawBody,
      signature: built.signature,
      eventId: built.eventId,
    });

    expect(result).toMatchObject({ outcome: 'REFUND_COMPLETED' });
    expect(repository.refunds[0]?.status).toBe('COMPLETED');
  });

  it('links the stored event to the payment it belongs to', async () => {
    const { service, repository } = harness;
    const { clientPayload } = await service.createIntent({ userId: USER, orderId: ORDER_ID });
    const built = await capture({ providerOrderId: clientPayload.providerOrderId });

    await service.handleWebhook({
      rawBody: built.rawBody,
      signature: built.signature,
      eventId: built.eventId,
    });

    expect(repository.events[0]?.paymentId).toBe(PAYMENT_ID);
    expect(repository.events[0]?.signatureValid).toBe(true);
  });
});

describe('getStatusForUser', () => {
  it('returns our own record without asking the provider when settled', async () => {
    const { service, provider } = build({
      payment: { status: 'PAID', providerPaymentId: 'pay_1' },
    });

    const status = await service.getStatusForUser({ userId: USER, paymentId: PAYMENT_ID });

    expect(status.status).toBe('PAID');
    expect(status.isPending).toBe(false);
    expect(provider.fetchCalls).toHaveLength(0);
  });

  it('answers NOT_FOUND for another customer', async () => {
    const { service } = harness;
    await expect(
      service.getStatusForUser({ userId: OTHER_USER, paymentId: PAYMENT_ID })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('SETTLES from the provider when the client offers a reference', async () => {
    const { service, repository, provider } = harness;
    const { clientPayload } = await service.createIntent({ userId: USER, orderId: ORDER_ID });

    provider.snapshotToReturn = {
      providerPaymentId: 'pay_real',
      providerOrderId: clientPayload.providerOrderId,
      status: 'PAID',
      amountPaise: 45_900,
      currency: 'INR',
      method: 'upi',
      failureCode: null,
      failureMessage: null,
      capturedAt: new Date(),
    };

    const status = await service.getStatusForUser({
      userId: USER,
      paymentId: PAYMENT_ID,
      providerPaymentIdHint: 'pay_real',
    });

    // This is what makes a lost webhook self-healing for the customer watching a spinner.
    expect(provider.fetchCalls).toEqual(['pay_real']);
    expect(status.status).toBe('PAID');
    expect(repository.snapshot().order.status).toBe('CONFIRMED');
  });

  it('IGNORES a reference that belongs to a different order', async () => {
    const { service, repository, provider } = harness;
    await service.createIntent({ userId: USER, orderId: ORDER_ID });

    // The attack this check exists for: any real captured payment of the same value would
    // otherwise confirm this order.
    provider.snapshotToReturn = {
      providerPaymentId: 'pay_someone_else',
      providerOrderId: 'order_mock_not_ours',
      status: 'PAID',
      amountPaise: 45_900,
      currency: 'INR',
      method: 'upi',
      failureCode: null,
      failureMessage: null,
      capturedAt: new Date(),
    };

    const status = await service.getStatusForUser({
      userId: USER,
      paymentId: PAYMENT_ID,
      providerPaymentIdHint: 'pay_someone_else',
    });

    expect(status.status).toBe('PENDING');
    expect(repository.snapshot().order.status).toBe('PENDING_PAYMENT');
  });

  it('does not settle on an amount that disagrees with the order', async () => {
    const { service, repository, provider } = harness;
    const { clientPayload } = await service.createIntent({ userId: USER, orderId: ORDER_ID });

    provider.snapshotToReturn = {
      providerPaymentId: 'pay_short',
      providerOrderId: clientPayload.providerOrderId,
      status: 'PAID',
      amountPaise: 100,
      currency: 'INR',
      method: 'upi',
      failureCode: null,
      failureMessage: null,
      capturedAt: new Date(),
    };

    await service.getStatusForUser({
      userId: USER,
      paymentId: PAYMENT_ID,
      providerPaymentIdHint: 'pay_short',
    });

    expect(repository.snapshot().payment.status).toBe('PENDING');
  });

  it('survives a provider outage and reports our last known state', async () => {
    const { service, provider } = harness;
    await service.createIntent({ userId: USER, orderId: ORDER_ID });
    provider.shouldThrowOnFetch = true;

    const status = await service.getStatusForUser({
      userId: USER,
      paymentId: PAYMENT_ID,
      providerPaymentIdHint: 'pay_whatever',
    });

    // A gateway outage must not break the page the customer is staring at.
    expect(status.status).toBe('PENDING');
    expect(status.isPending).toBe(true);
  });
});

describe('reconcileStalePayments', () => {
  it('settles a payment whose webhook was lost', async () => {
    const { service, repository, provider } = build({
      payment: {
        status: 'PENDING',
        providerOrderId: 'order_mock_abc',
        providerPaymentId: 'pay_lost',
      },
    });

    provider.snapshotToReturn = {
      providerPaymentId: 'pay_lost',
      providerOrderId: 'order_mock_abc',
      status: 'PAID',
      amountPaise: 45_900,
      currency: 'INR',
      method: 'upi',
      failureCode: null,
      failureMessage: null,
      capturedAt: new Date(),
    };

    const result = await service.reconcileStalePayments({ olderThanMinutes: 0 });

    expect(result.settled).toBe(1);
    expect(repository.snapshot().order.status).toBe('CONFIRMED');
  });

  it('skips a payment that was never attempted', async () => {
    // An intent with no provider payment id has nothing to ask about; the unpaid-order sweep
    // releases its stock instead.
    const { service, provider } = build({
      payment: { status: 'PENDING', providerPaymentId: null },
    });

    const result = await service.reconcileStalePayments({ olderThanMinutes: 0 });

    expect(result.checked).toBe(0);
    expect(provider.fetchCalls).toHaveLength(0);
  });

  it('keeps going when one payment cannot be reached', async () => {
    const { service, provider } = build({
      payment: { status: 'PENDING', providerPaymentId: 'pay_unreachable' },
    });
    provider.shouldThrowOnFetch = true;

    await expect(service.reconcileStalePayments({ olderThanMinutes: 0 })).resolves.toMatchObject({
      settled: 0,
    });
  });
});

describe('refundOrder', () => {
  it('reverses a prepaid payment through the gateway', async () => {
    const { service, repository } = build({
      payment: { status: 'PAID', providerPaymentId: 'pay_1' },
      order: { status: 'CONFIRMED' },
    });

    const result = await service.refundOrder({
      orderId: ORDER_ID,
      amountPaise: 45_900,
      reason: 'Out of stock',
      initiatedBy: 'admin-1',
    });

    expect(result.mode).toBe('GATEWAY');
    expect(result.refund.providerRefundId).toMatch(/^rfnd_mock_/);
    expect(repository.refunds).toHaveLength(1);
  });

  it('records a COD refund as a MANUAL PAYOUT with no gateway reference', async () => {
    const { service, repository } = build({
      payment: { status: 'PAID', method: 'COD', provider: 'cod' },
      order: { isCod: true, status: 'DELIVERED' },
    });

    const result = await service.refundOrder({
      orderId: ORDER_ID,
      amountPaise: 45_900,
      reason: 'Damaged goods',
      initiatedBy: 'admin-1',
    });

    // There is no captured gateway payment to reverse, so a person has to pay this out (D-15).
    expect(result.mode).toBe('MANUAL_PAYOUT');
    expect(result.refund.providerRefundId).toBeNull();
    expect(repository.refunds[0]?.paymentId).toBeNull();
  });

  it('refuses to refund more than the order was worth', async () => {
    const { service } = build({ payment: { status: 'PAID', providerPaymentId: 'pay_1' } });

    await expect(
      service.refundOrder({
        orderId: ORDER_ID,
        amountPaise: 50_000,
        reason: 'too much',
        initiatedBy: 'admin-1',
      })
    ).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
  });

  it('refuses a second refund that would exceed the total in aggregate', async () => {
    const { service } = build({ payment: { status: 'PAID', providerPaymentId: 'pay_1' } });

    await service.refundOrder({
      orderId: ORDER_ID,
      amountPaise: 40_000,
      reason: 'partial',
      initiatedBy: 'admin-1',
    });

    // 40,000 + 10,000 > 45,900. The ceiling is on the SUM, not on each refund.
    await expect(
      service.refundOrder({
        orderId: ORDER_ID,
        amountPaise: 10_000,
        reason: 'second',
        initiatedBy: 'admin-1',
      })
    ).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
  });

  it('allows partial refunds that stay under the total', async () => {
    const { service, repository } = build({
      payment: { status: 'PAID', providerPaymentId: 'pay_1' },
    });

    await service.refundOrder({
      orderId: ORDER_ID,
      amountPaise: 20_000,
      reason: 'a',
      initiatedBy: null,
    });
    await service.refundOrder({
      orderId: ORDER_ID,
      amountPaise: 20_000,
      reason: 'b',
      initiatedBy: null,
    });

    expect(repository.refunds).toHaveLength(2);
    expect(repository.refunds.every((refund) => refund.refundType === 'PARTIAL')).toBe(true);
  });

  it('treats an unpaid prepaid order as a manual payout, not a gateway reversal', async () => {
    // Nothing was captured, so there is nothing at the gateway to reverse — and a gateway
    // refund call would fail rather than helping the customer.
    const { service } = build({ payment: { status: 'PENDING' } });

    const result = await service.refundOrder({
      orderId: ORDER_ID,
      amountPaise: 1_000,
      reason: 'goodwill',
      initiatedBy: 'admin-1',
    });

    expect(result.mode).toBe('MANUAL_PAYOUT');
  });

  it('answers NOT_FOUND for an unknown order', async () => {
    const { service } = harness;
    await expect(
      service.refundOrder({
        orderId: '99999999-9999-7999-8999-999999999999',
        amountPaise: 100,
        reason: 'x',
        initiatedBy: null,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/** Signs a body with the published mock secret, for the hand-built payloads above. */
async function signMock(body: string): Promise<string> {
  const { hmacSha256Hex } = await import('@/lib/payments/hmac');
  const { MOCK_WEBHOOK_SECRET } = await import('@/lib/payments/mock-provider');
  return hmacSha256Hex(MOCK_WEBHOOK_SECRET, body);
}
