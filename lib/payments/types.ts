/**
 * Payment provider contract (docs/ARCHITECTURE.md §11.2).
 *
 * Business modules depend on THESE types, never on Razorpay's. Razorpay is the approved V1
 * provider (D-13) and no second provider is planned, but the seam still earns its keep: it is
 * what makes a deterministic mock gateway possible, and a mock gateway is what makes the
 * payment path — intent, signed webhook, capture, refund — testable in CI without a merchant
 * account. Without the seam, every payment test would need real credentials, which in
 * practice means no payment tests at all.
 *
 * THE ONE RULE THAT SHAPES THIS FILE: **the webhook is the only trusted source of payment
 * truth** (docs/SECURITY.md §8.1). Nothing here accepts a client-reported outcome. The
 * browser can only ask the server to re-check (`fetchPaymentStatus`), never assert.
 */

/** Our payment status vocabulary, matching the `payment_status` enum in the database. */
export type ProviderPaymentStatus =
  | 'CREATED'
  | 'PENDING'
  | 'AUTHORIZED'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

export type ProviderRefundStatus = 'INITIATED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

/**
 * What the browser needs to open the gateway.
 *
 * Deliberately opaque to everything except the checkout component: the shape is the
 * provider's business, and typing it precisely here would put Razorpay's field names into
 * every layer the payload passes through. It carries NO secret — the key id is public, and
 * the secret never leaves the server.
 */
export interface PaymentClientPayload {
  provider: string;
  /** Public key id, handed over per-request so a rotation needs no rebuild. */
  keyId: string;
  /** The provider's order/intent reference the client must present. */
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  /** Where the provider should call back to on completion, when it supports one. */
  callbackUrl?: string | undefined;
}

export interface CreateIntentInput {
  /** Our order id, sent to the provider as a reference for reconciliation. */
  orderId: string;
  orderNumber: string;
  amountPaise: number;
  currency: string;
  /**
   * REQUIRED. Passed to the provider so a retried intent creation returns the SAME provider
   * order rather than creating a second one the customer could also pay.
   */
  idempotencyKey: string;
  customerContact?: { name?: string | undefined; phone?: string | undefined } | undefined;
}

export interface CreateIntentResult {
  providerOrderId: string;
  clientPayload: PaymentClientPayload;
}

/**
 * A webhook event AFTER its signature has been verified.
 *
 * `providerEventId` is the replay key. It is stored under a unique index, so a duplicate
 * delivery is rejected by the database rather than by a code path that might be racing with
 * itself (docs/SECURITY.md §8.3).
 */
export interface VerifiedWebhookEvent {
  provider: string;
  providerEventId: string;
  /** Our normalised event meaning, so the service never switches on provider strings. */
  kind: 'PAYMENT_CAPTURED' | 'PAYMENT_AUTHORIZED' | 'PAYMENT_FAILED' | 'REFUND_PROCESSED' | 'OTHER';
  eventType: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  providerRefundId: string | null;
  /**
   * The amount the PROVIDER says was moved.
   *
   * Compared against our own record before anything is marked paid. A webhook that claims a
   * smaller amount than the order is either a partial capture or a forgery, and either way
   * must not confirm the order (docs/SECURITY.md §8.1).
   */
  amountPaise: number | null;
  currency: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  /** Provider event timestamp, for the freshness window. */
  occurredAt: Date | null;
  /** The raw parsed body, stored verbatim in `payment_events.raw_payload`. */
  payload: Record<string, unknown>;
}

export interface ProviderPaymentSnapshot {
  providerPaymentId: string;
  /**
   * The provider's own record of which intent this payment belongs to.
   *
   * Checked against our stored intent before anything is marked paid. Without it, a customer
   * could hand us the id of a DIFFERENT (real, captured) payment and have it confirm their
   * order — the amount alone is not enough, because two orders can cost the same.
   */
  providerOrderId: string | null;
  status: ProviderPaymentStatus;
  amountPaise: number;
  currency: string;
  method: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  capturedAt: Date | null;
}

export interface RefundInput {
  providerPaymentId: string;
  amountPaise: number;
  idempotencyKey: string;
  notes?: Record<string, string> | undefined;
}

export interface RefundResult {
  providerRefundId: string;
  status: ProviderRefundStatus;
  amountPaise: number;
}

/**
 * The verification outcome.
 *
 * A discriminated union rather than a boolean plus an out-parameter, so an invalid signature
 * cannot be accidentally treated as a valid event by a caller that forgot to check.
 */
export type WebhookVerification =
  | { ok: true; event: VerifiedWebhookEvent }
  | { ok: false; reason: 'SIGNATURE_INVALID' | 'MALFORMED' | 'STALE' | 'NOT_CONFIGURED' };

export interface WebhookRequest {
  /** Exactly the bytes the provider signed. Never a re-serialised object. */
  rawBody: string;
  signature: string | null;
  /**
   * The provider's own event id, which arrives in a HEADER rather than the body for Razorpay.
   *
   * It is the replay key, stored under a unique index. When a provider omits it, the adapter
   * derives a deterministic one from the event type and the payment id — a derived key is
   * weaker than a provider-issued one, but no key at all would mean no replay protection.
   */
  eventId?: string | null;
  /** Injectable clock, so the freshness window is testable without waiting. */
  now?: Date | undefined;
}

export interface PaymentProvider {
  readonly name: string;

  /** True when this provider has everything it needs to CREATE a payment. */
  isConfigured(): boolean;

  /** True when this provider can VERIFY a webhook. Separate: the secrets are separate. */
  canVerifyWebhooks(): boolean;

  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;

  /**
   * Verifies a webhook over the RAW body.
   *
   * Takes the raw string, not a parsed object: the signature covers exact bytes, and
   * `JSON.parse` followed by `JSON.stringify` does not round-trip byte-for-byte. Re-serialising
   * before verifying is the classic way to make a correct HMAC check fail — or, worse, to make
   * a forged payload pass.
   */
  verifyWebhook(input: WebhookRequest): Promise<WebhookVerification>;

  fetchPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentSnapshot>;

  refund(input: RefundInput): Promise<RefundResult>;

  fetchRefundStatus(providerRefundId: string): Promise<{ status: ProviderRefundStatus }>;
}
