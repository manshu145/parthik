import { sql } from 'drizzle-orm';
import { boolean, date, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, paiseNotNull, percentage, primaryId, timestamps, ts } from './_helpers';
import {
  payeeType,
  paymentMethod,
  paymentStatus,
  payoutStatus,
  refundStatus,
  refundType,
  sellerType,
} from './enums';
import { users } from './identity';
import { orders } from './commerce';

/**
 * Payments domain (docs/DATABASE.md §6, decisions D-12 and D-13).
 *
 * The webhook is the only trusted source of payment truth for prepaid orders. For
 * COD, only a driver's confirmed delivery (with valid OTP) or an admin correction
 * may advance a payment to PAID, and that writes the cash ledger entry in the same
 * transaction so cash-collected and payment-paid can never diverge.
 */

export const payments = pgTable(
  'payments',
  {
    id: primaryId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),

    /** 'razorpay' in V1 (D-13); 'cod' for the cash path. */
    provider: text('provider').notNull(),
    providerPaymentId: text('provider_payment_id'),
    providerOrderId: text('provider_order_id'),

    method: paymentMethod('method').notNull(),
    amountPaise: paiseNotNull('amount_paise'),
    currency: text('currency').notNull().default('INR'),
    status: paymentStatus('status').notNull(),

    idempotencyKey: text('idempotency_key').notNull(),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),

    authorizedAt: ts('authorized_at'),
    paidAt: ts('paid_at'),
    failedAt: ts('failed_at'),

    /** Set by the reconciliation job that catches lost webhooks. */
    reconciledAt: ts('reconciled_at'),
    reconciliationNote: text('reconciliation_note'),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('payments_idempotency_key').on(table.idempotencyKey),
    index('payments_order_idx').on(table.orderId),
    index('payments_provider_payment_idx').on(table.providerPaymentId),
    // Reconciliation sweep: payments stuck awaiting confirmation.
    index('payments_reconciliation_idx')
      .on(table.status, table.createdAt)
      .where(sql`status in ('CREATED', 'PENDING')`),
  ]
);

/**
 * Raw provider interaction log — the evidence trail for disputes.
 *
 * The unique `provider_event_id` is webhook replay protection AT THE DATABASE
 * LEVEL, not merely in code: a duplicate delivery fails the insert rather than
 * reprocessing a payment.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: primaryId(),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    eventType: text('event_type').notNull(),
    providerEventId: text('provider_event_id').notNull(),

    rawPayload: jsonb('raw_payload').notNull(),
    signature: text('signature'),
    signatureValid: boolean('signature_valid').notNull(),

    processedAt: ts('processed_at'),
    processingError: text('processing_error'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('payment_events_provider_event_key').on(table.providerEventId),
    index('payment_events_payment_idx').on(table.paymentId),
    index('payment_events_received_idx').on(table.receivedAt),
    // Security signal: a burst of invalid signatures is treated as an attack.
    index('payment_events_invalid_signature_idx')
      .on(table.receivedAt)
      .where(sql`signature_valid = false`),
  ]
);

export const refunds = pgTable(
  'refunds',
  {
    id: primaryId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    /**
     * NULL for a COD refund: there is no captured gateway payment to reverse, so
     * it becomes a manual payout with its own approval trail (D-15).
     */
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    providerRefundId: text('provider_refund_id'),

    amountPaise: paiseNotNull('amount_paise'),
    reason: text('reason'),
    refundType: refundType('refund_type').notNull(),
    status: refundStatus('status').notNull().default('INITIATED'),

    initiatedBy: uuid('initiated_by').references(() => users.id, { onDelete: 'set null' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    initiatedAt: ts('initiated_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
    failureReason: text('failure_reason'),
    notes: text('notes'),

    ...timestamps,
  },
  (table) => [
    index('refunds_order_idx').on(table.orderId),
    index('refunds_payment_idx').on(table.paymentId),
    index('refunds_status_idx').on(table.status, table.createdAt),
  ]
);

/**
 * Invoices — table created, NO ROWS PRODUCED in V1.
 *
 * D-14 (GST/tax) is BLOCKED, so no tax invoice is generated and no invoice number
 * is issued. Customers receive an order summary that is explicitly not labelled a
 * tax invoice. The table exists now so unblocking D-14 is a backfill rather than a
 * migration across live financial tables.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: primaryId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    invoiceNumber: text('invoice_number').notNull(),
    invoiceDate: date('invoice_date').notNull(),

    sellerType: sellerType('seller_type').notNull(),
    sellerName: text('seller_name'),
    sellerGstin: text('seller_gstin'),
    buyerName: text('buyer_name'),
    buyerState: text('buyer_state'),

    taxableAmountPaise: paiseNotNull('taxable_amount_paise'),
    taxBreakup: jsonb('tax_breakup'),
    totalAmountPaise: paiseNotNull('total_amount_paise'),
    pdfStorageKey: text('pdf_storage_key'),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('invoices_order_key').on(table.orderId),
    uniqueIndex('invoices_number_key').on(table.invoiceNumber),
  ]
);

/**
 * Tax rates — table created, NOT SEEDED (D-14 blocked).
 *
 * Historical rates are retained with effective dates so an old invoice remains
 * reproducible once invoicing exists.
 */
export const taxRates = pgTable(
  'tax_rates',
  {
    id: primaryId(),
    name: text('name').notNull(),
    hsnCode: text('hsn_code'),
    rate: percentage('rate').notNull(),
    cessRate: percentage('cess_rate'),
    isActive: boolean('is_active').notNull().default(true),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    createdAt: createdAt(),
  },
  (table) => [
    index('tax_rates_hsn_idx').on(table.hsnCode),
    index('tax_rates_active_idx').on(table.isActive, table.effectiveFrom),
  ]
);

/**
 * Payout batches. V1 records and reports; actual money movement is manual
 * pending D-15.
 */
export const payoutBatches = pgTable(
  'payout_batches',
  {
    id: primaryId(),
    payeeType: payeeType('payee_type').notNull(),
    payeeId: uuid('payee_id').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),

    grossAmountPaise: paiseNotNull('gross_amount_paise'),
    deductionsPaise: paiseNotNull('deductions_paise'),
    netAmountPaise: paiseNotNull('net_amount_paise'),

    status: payoutStatus('status').notNull().default('DRAFT'),
    referenceNumber: text('reference_number'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: ts('approved_at'),
    paidAt: ts('paid_at'),
    notes: text('notes'),

    ...timestamps,
  },
  (table) => [
    index('payout_batches_payee_idx').on(table.payeeType, table.payeeId, table.periodStart),
    index('payout_batches_status_idx').on(table.status),
  ]
);
