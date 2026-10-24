import type { ProviderPaymentStatus, ProviderRefundStatus } from '@/lib/payments/types';
import type { OrderStatus } from '@/modules/order';

/**
 * Payment repository contract.
 *
 * Shaped by one rule from docs/SECURITY.md §8.1: **only a verified webhook or the
 * reconciliation job may mark a payment paid.** So there is no `setStatus`. The only ways a
 * payment can become PAID are `applyCapture` and `applyReconciledStatus`, both of which take
 * evidence — a stored event or a provider snapshot — and both of which move the ORDER in the
 * same transaction. A generic setter would make "mark it paid because the browser said so" a
 * one-line change.
 */

export type PaymentMethod = 'UPI' | 'CARD' | 'COD';

export interface PaymentRecord {
  id: string;
  orderId: string;
  provider: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  method: PaymentMethod;
  amountPaise: number;
  currency: string;
  status: ProviderPaymentStatus;
  idempotencyKey: string;
  failureCode: string | null;
  failureMessage: string | null;
  authorizedAt: Date | null;
  paidAt: Date | null;
  failedAt: Date | null;
  reconciledAt: Date | null;
  createdAt: Date;
}

/** A payment plus the order facts every decision about it needs. */
export interface PaymentWithOrder {
  payment: PaymentRecord;
  order: {
    id: string;
    orderNumber: string;
    userId: string;
    status: OrderStatus;
    totalAmountPaise: number;
    isCod: boolean;
    paymentStatus: string;
  };
}

export interface RecordEventInput {
  provider: string;
  eventType: string;
  providerEventId: string;
  rawPayload: Record<string, unknown>;
  signature: string | null;
  signatureValid: boolean;
  paymentId: string | null;
}

/**
 * The outcome of storing an event.
 *
 * `DUPLICATE` is the normal case, not an error: providers retry, and the retry must be
 * cheap and side-effect free. Reported by the DATABASE's unique index rather than by a
 * prior read, because two deliveries can arrive concurrently and a check-then-insert would
 * let both through (docs/SECURITY.md §8.3).
 */
export type RecordEventResult =
  { ok: true; eventId: string } | { ok: false; reason: 'DUPLICATE'; eventId: string | null };

/**
 * What happened when a captured payment was applied.
 *
 * `PAID_AFTER_CANCELLATION` is the case that matters most and the reason this is an enum
 * rather than a boolean: the unpaid-order sweep can cancel an order seconds before its
 * payment is captured. The money HAS moved, so the payment must be recorded as PAID — and a
 * refund is now owed. Swallowing that as "already handled" would keep a customer's money for
 * an order that no longer exists.
 */
export type CaptureOutcome =
  | 'CONFIRMED'
  | 'ALREADY_PAID'
  | 'AMOUNT_MISMATCH'
  | 'PAID_AFTER_CANCELLATION'
  | 'PAID_WITHOUT_TRANSITION';

export interface ApplyCaptureInput {
  paymentId: string;
  providerPaymentId: string;
  /** What the provider says it captured, compared against our own record. */
  amountPaise: number;
  paidAt: Date;
  /** The stored event this capture came from, marked processed in the same transaction. */
  eventId: string | null;
}

export type FailureOutcome = 'PAYMENT_FAILED' | 'ALREADY_FAILED' | 'ALREADY_PAID' | 'NO_TRANSITION';

export interface ApplyFailureInput {
  paymentId: string;
  providerPaymentId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  eventId: string | null;
}

export interface CreateRefundInput {
  orderId: string;
  /** NULL for COD: there is no captured gateway payment to reverse (D-15). */
  paymentId: string | null;
  amountPaise: number;
  reason: string;
  initiatedBy: string | null;
  providerRefundId: string | null;
  status: ProviderRefundStatus;
  /** True when this is a cash refund that a human has to pay out. */
  isManualPayout: boolean;
}

export interface RefundRecord {
  id: string;
  orderId: string;
  paymentId: string | null;
  providerRefundId: string | null;
  amountPaise: number;
  status: ProviderRefundStatus;
  refundType: 'FULL' | 'PARTIAL';
  createdAt: Date;
}

export interface PaymentRepository {
  findForOrder(orderId: string): Promise<PaymentWithOrder | null>;
  findById(paymentId: string): Promise<PaymentWithOrder | null>;
  /** Ownership is part of the query, so another customer's payment id resolves to null. */
  findForUser(userId: string, paymentId: string): Promise<PaymentWithOrder | null>;
  findByProviderOrderId(providerOrderId: string): Promise<PaymentWithOrder | null>;
  findByProviderPaymentId(providerPaymentId: string): Promise<PaymentWithOrder | null>;

  /**
   * Records the provider's intent reference against the EXISTING payment row.
   *
   * An update, never an insert: the order module already created the payment row inside the
   * order transaction, so inserting here would produce two payment rows for one order and
   * make the amount owed ambiguous.
   */
  attachIntent(input: { paymentId: string; providerOrderId: string }): Promise<PaymentRecord>;

  recordEvent(input: RecordEventInput): Promise<RecordEventResult>;
  markEventProcessed(eventId: string, error?: string | null): Promise<void>;

  /** Marks the payment paid and confirms the order in ONE transaction. */
  applyCapture(input: ApplyCaptureInput): Promise<{ outcome: CaptureOutcome; orderId: string }>;

  /** Marks the payment failed and releases the stock in ONE transaction. */
  applyFailure(input: ApplyFailureInput): Promise<{ outcome: FailureOutcome; orderId: string }>;

  /** Payments that never reached a settled state, for the reconciliation job. */
  listStalePending(before: Date, limit: number): Promise<PaymentWithOrder[]>;
  markReconciled(paymentId: string, note: string): Promise<void>;

  /** Sum of refunds already recorded for an order, for the over-refund check. */
  refundedTotalPaise(orderId: string): Promise<number>;

  /**
   * Records a refund, refusing to exceed what was captured.
   *
   * The check happens INSIDE the transaction against the summed total, because two
   * concurrent refunds that each pass an outside check would together exceed the payment
   * (docs/SECURITY.md §8.1 rule 4).
   */
  createRefund(
    input: CreateRefundInput
  ): Promise<{ ok: true; refund: RefundRecord } | { ok: false; reason: 'EXCEEDS_PAYMENT' }>;

  markRefundStatus(providerRefundId: string, status: ProviderRefundStatus): Promise<void>;
}
