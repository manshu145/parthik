import { getServerEnv } from '@/lib/config/env';
import { logger } from '@/lib/logger';
import { MockPaymentProvider } from './mock-provider';
import { RazorpayProvider } from './razorpay-provider';
import type { PaymentProvider } from './types';

/**
 * Chooses the payment provider (D-13).
 *
 * Same three-way switch as `lib/maps/provider-factory.ts`, with one rule that matters far
 * more here:
 *
 *   **`auto` NEVER resolves to the mock in production.**
 *
 * A mock maps provider returns a plausible distance. A mock PAYMENT provider would tell a
 * customer their payment succeeded when no money moved — and would mark the order paid. So an
 * unconfigured production deployment gets the real adapter, which raises a typed 503 the
 * moment anything touches it, rather than a fake gateway that quietly works.
 *
 * `PAYMENTS_PROVIDER=mock` is still honoured in production, because an explicit setting is a
 * deliberate act and there are legitimate uses (a load test against a copy of prod). It is
 * logged at ERROR so it cannot happen quietly.
 */

export type PaymentProviderName = 'razorpay' | 'mock';

export interface ResolvedPaymentProvider {
  provider: PaymentProvider;
  name: PaymentProviderName;
  /** True when the mock is standing in for absent credentials rather than being requested. */
  isFallback: boolean;
}

let warnedAboutMock = false;

export function resolvePaymentProvider(): ResolvedPaymentProvider {
  const env = getServerEnv();
  const isProduction = env.APP_ENV === 'production';

  if (env.PAYMENTS_PROVIDER === 'mock') {
    if (isProduction) {
      logger.error(
        'PAYMENTS_PROVIDER=mock in production. No money will move and orders will be marked paid against a fake gateway.'
      );
    }
    return { provider: new MockPaymentProvider(), name: 'mock', isFallback: false };
  }

  if (env.PAYMENTS_PROVIDER === 'razorpay') {
    // Returned as-is even when unconfigured, so Razorpay's own ConfigurationError surfaces
    // instead of being masked by a silent downgrade.
    return { provider: new RazorpayProvider(), name: 'razorpay', isFallback: false };
  }

  const razorpay = new RazorpayProvider();

  if (razorpay.isConfigured()) {
    return { provider: razorpay, name: 'razorpay', isFallback: false };
  }

  if (isProduction) {
    // The real adapter, deliberately. It will fail loudly with a 503 the first time a customer
    // tries to pay, which is the correct outcome — COD keeps working in the meantime.
    logger.error(
      'Razorpay is not configured in production. Prepaid payments will fail; cash on delivery is unaffected.'
    );
    return { provider: razorpay, name: 'razorpay', isFallback: false };
  }

  if (!warnedAboutMock) {
    warnedAboutMock = true;
    logger.info(
      'Using the mock payment gateway — no RAZORPAY_KEY_ID configured. Intents, signed webhooks and refunds all work; no money moves.'
    );
  }

  return { provider: new MockPaymentProvider(), name: 'mock', isFallback: true };
}

export function getPaymentProvider(): PaymentProvider {
  return resolvePaymentProvider().provider;
}

/** Test-only: lets a case observe the one-time warning again. */
export function resetPaymentProviderWarningForTests(): void {
  warnedAboutMock = false;
}
