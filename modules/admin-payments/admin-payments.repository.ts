import { desc, eq } from 'drizzle-orm';
import { orders, payments, payoutBatches, refunds } from '@/db/schema';
import { getDb } from '@/lib/db/client';

export async function listAdminPayments(limit = 250) {
  const db = await getDb();

  return db
    .select({
      id: payments.id,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      provider: payments.provider,
      providerPaymentId: payments.providerPaymentId,
      method: payments.method,
      amountPaise: payments.amountPaise,
      currency: payments.currency,
      status: payments.status,
      failureCode: payments.failureCode,
      failureMessage: payments.failureMessage,
      authorizedAt: payments.authorizedAt,
      paidAt: payments.paidAt,
      failedAt: payments.failedAt,
      reconciledAt: payments.reconciledAt,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export async function listAdminRefunds(limit = 250) {
  const db = await getDb();

  return db
    .select({
      id: refunds.id,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      paymentId: refunds.paymentId,
      providerRefundId: refunds.providerRefundId,
      amountPaise: refunds.amountPaise,
      reason: refunds.reason,
      refundType: refunds.refundType,
      status: refunds.status,
      initiatedAt: refunds.initiatedAt,
      completedAt: refunds.completedAt,
      failureReason: refunds.failureReason,
      createdAt: refunds.createdAt,
    })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .orderBy(desc(refunds.createdAt), desc(refunds.id))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export async function listAdminPayoutBatches(limit = 250) {
  const db = await getDb();

  return db
    .select({
      id: payoutBatches.id,
      payeeType: payoutBatches.payeeType,
      payeeId: payoutBatches.payeeId,
      periodStart: payoutBatches.periodStart,
      periodEnd: payoutBatches.periodEnd,
      grossAmountPaise: payoutBatches.grossAmountPaise,
      deductionsPaise: payoutBatches.deductionsPaise,
      netAmountPaise: payoutBatches.netAmountPaise,
      status: payoutBatches.status,
      referenceNumber: payoutBatches.referenceNumber,
      approvedAt: payoutBatches.approvedAt,
      paidAt: payoutBatches.paidAt,
      notes: payoutBatches.notes,
      createdAt: payoutBatches.createdAt,
    })
    .from(payoutBatches)
    .orderBy(desc(payoutBatches.createdAt), desc(payoutBatches.id))
    .limit(Math.min(Math.max(limit, 1), 500));
}
