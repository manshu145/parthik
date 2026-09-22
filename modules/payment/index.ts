import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { ConfigurationError } from '@/lib/errors';
import {
  resolvePaymentProvider,
  type PaymentProviderName,
  type ResolvedPaymentProvider,
} from '@/lib/payments/provider-factory';
import { DrizzlePaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';
import { readProviderSetting } from '@/modules/provider-settings';
import { MockPaymentProvider } from '@/lib/payments/mock-provider';
import { RazorpayProvider } from '@/lib/payments/razorpay-provider';

/**
 * Payment module composition root.
 *
 * NO IN-MEMORY BACKEND, for the same reason the order module has none: a payment is a financial
 * record. A version of it that evaporates on restart would let someone "pay" in a preview
 * environment and see a confirmation for money that was never taken, which is worse than a
 * clear failure.
 *
 * The GATEWAY, by contrast, does have a credential-free fallback. That asymmetry is the point:
 * the LEDGER must be real so nothing is lost, while the gateway can be a deterministic mock so
 * the whole path — intent, signed webhook, capture, refund — is testable without a merchant
 * account. `lib/payments/provider-factory.ts` refuses to hand out the mock in production.
 */
export async function getPaymentService(): Promise<PaymentService> {
  if (!isDatabaseConfigured()) {
    throw new ConfigurationError(
      'Payments require a database. Set DATABASE_URL — there is deliberately no in-memory payment backend, because a payment record that disappears on restart is worse than a payment that was never taken.'
    );
  }

  const db = await getDb();
  const resolved = await resolveEffectivePaymentProvider();

  return new PaymentService({
    repository: new DrizzlePaymentRepository({ db }),
    provider: resolved.provider,
  });
}

/** Whether prepaid payments can be taken in this environment. */
export async function isPrepaidPaymentAvailable(): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  const resolved = await resolveEffectivePaymentProvider();
  return resolved.provider.isConfigured();
}

/**
 * What the diagnostics endpoint reports.
 *
 * Booleans and names only — no key, no prefix, no length. Exposed through the module so a route
 * never has to import the provider factory itself.
 */
export async function describePaymentBackend(): Promise<{
  provider: PaymentProviderName;
  usingMockGateway: boolean;
  isFallback: boolean;
  canCreateIntents: boolean;
  canVerifyWebhooks: boolean;
  databaseConfigured: boolean;
}> {
  const resolved = await resolveEffectivePaymentProvider();

  return {
    provider: resolved.name,
    usingMockGateway: resolved.name === 'mock',
    isFallback: resolved.isFallback,
    canCreateIntents: resolved.provider.isConfigured(),
    // Reported separately, because a deployment with a key pair but no webhook secret can take
    // money it will never be able to confirm.
    canVerifyWebhooks: resolved.provider.canVerifyWebhooks(),
    databaseConfigured: isDatabaseConfigured(),
  };
}

async function resolveEffectivePaymentProvider(): Promise<ResolvedPaymentProvider> {
  if (!isDatabaseConfigured()) return resolvePaymentProvider();

  const [selected, keyId, keySecret, webhookSecret] = await Promise.all([
    readProviderSetting('payments.provider'),
    readProviderSetting('payments.razorpay_key_id'),
    readProviderSetting('payments.razorpay_key_secret'),
    readProviderSetting('payments.razorpay_webhook_secret'),
  ]);

  if (selected === 'mock') {
    return { provider: new MockPaymentProvider(), name: 'mock', isFallback: false };
  }

  if (keyId && keySecret) {
    return {
      provider: new RazorpayProvider({ keyId, keySecret, webhookSecret }),
      name: 'razorpay',
      isFallback: false,
    };
  }

  if (selected === 'razorpay') {
    return { provider: new RazorpayProvider(), name: 'razorpay', isFallback: false };
  }

  return resolvePaymentProvider();
}

export { PaymentService, createPaymentService } from './payment.service';
export type { PaymentServiceDeps, PaymentStatusView, WebhookResult } from './payment.service';
export { DrizzlePaymentRepository, createPaymentRepository } from './payment.repository';
export {
  paymentIdParamSchema,
  paymentIntentBodySchema,
  paymentStatusQuerySchema,
  refundBodySchema,
  webhookProviderParamSchema,
} from './payment.schema';
export type { PaymentIntentBody, RefundBody } from './payment.schema';
export type {
  CaptureOutcome,
  FailureOutcome,
  PaymentRecord,
  PaymentRepository,
  PaymentWithOrder,
  RefundRecord,
} from './payment.repository.types';
