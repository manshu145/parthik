import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/config/env';
import {
  resetPaymentProviderWarningForTests,
  resolvePaymentProvider,
} from '@/lib/payments/provider-factory';

/**
 * Payment provider selection.
 *
 * ONE RULE MATTERS MORE THAN THE REST: `auto` must never resolve to the mock gateway in
 * production. A mock maps provider returns a plausible distance; a mock PAYMENT gateway would
 * tell a customer their payment succeeded and mark the order paid when no money moved. So an
 * unconfigured production deployment gets the real adapter, which fails loudly with a 503.
 *
 * Every case here manipulates the environment directly, because that is the only input the
 * factory has.
 */

const KEYS = [
  'APP_ENV',
  'PAYMENTS_PROVIDER',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  for (const key of KEYS) delete process.env[key];
  resetEnvCacheForTests();
  resetPaymentProviderWarningForTests();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvCacheForTests();
});

function configureRazorpay(): void {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_abc123';
  process.env.RAZORPAY_KEY_SECRET = 'secret-value';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret-value';
  resetEnvCacheForTests();
}

describe('auto', () => {
  it('falls back to the mock gateway in development with no credentials', () => {
    process.env.APP_ENV = 'development';
    resetEnvCacheForTests();

    const resolved = resolvePaymentProvider();

    // A fresh clone must be able to exercise the whole payment path.
    expect(resolved.name).toBe('mock');
    expect(resolved.isFallback).toBe(true);
  });

  it('falls back to the mock gateway in preview with no credentials', () => {
    process.env.APP_ENV = 'preview';
    resetEnvCacheForTests();

    expect(resolvePaymentProvider().name).toBe('mock');
  });

  it('uses Razorpay as soon as the key pair is present', () => {
    process.env.APP_ENV = 'development';
    configureRazorpay();

    const resolved = resolvePaymentProvider();

    expect(resolved.name).toBe('razorpay');
    expect(resolved.isFallback).toBe(false);
  });

  it('NEVER falls back to the mock gateway in production', () => {
    // The single most important assertion in this file. A fake gateway in production would
    // confirm orders for money that never moved.
    process.env.APP_ENV = 'production';
    resetEnvCacheForTests();

    const resolved = resolvePaymentProvider();

    expect(resolved.name).toBe('razorpay');
    expect(resolved.isFallback).toBe(false);
    // Unconfigured, so it will raise a typed 503 the moment anyone tries to pay — which is the
    // correct outcome, and COD keeps working meanwhile.
    expect(resolved.provider.isConfigured()).toBe(false);
  });

  it('uses Razorpay in production when configured', () => {
    process.env.APP_ENV = 'production';
    configureRazorpay();

    const resolved = resolvePaymentProvider();

    expect(resolved.name).toBe('razorpay');
    expect(resolved.provider.isConfigured()).toBe(true);
    expect(resolved.provider.canVerifyWebhooks()).toBe(true);
  });
});

describe('explicit selection', () => {
  it('honours PAYMENTS_PROVIDER=mock in development', () => {
    process.env.APP_ENV = 'development';
    process.env.PAYMENTS_PROVIDER = 'mock';
    resetEnvCacheForTests();

    const resolved = resolvePaymentProvider();

    expect(resolved.name).toBe('mock');
    // Requested, not a fallback — the distinction the diagnostics endpoint reports.
    expect(resolved.isFallback).toBe(false);
  });

  it('honours PAYMENTS_PROVIDER=mock even in production, deliberately', () => {
    // An explicit setting is a deliberate act (a load test against a copy of prod). It is
    // logged at ERROR so it cannot happen quietly.
    process.env.APP_ENV = 'production';
    process.env.PAYMENTS_PROVIDER = 'mock';
    resetEnvCacheForTests();

    expect(resolvePaymentProvider().name).toBe('mock');
  });

  it('returns Razorpay unconfigured rather than silently downgrading', () => {
    process.env.APP_ENV = 'development';
    process.env.PAYMENTS_PROVIDER = 'razorpay';
    resetEnvCacheForTests();

    const resolved = resolvePaymentProvider();

    // Asking for Razorpay and getting the mock would hide a missing credential until launch.
    expect(resolved.name).toBe('razorpay');
    expect(resolved.provider.isConfigured()).toBe(false);
  });

  it('rejects an unknown provider name at the config boundary', () => {
    process.env.PAYMENTS_PROVIDER = 'stripe';
    resetEnvCacheForTests();

    expect(() => resolvePaymentProvider()).toThrow(/PAYMENTS_PROVIDER/i);
  });
});

describe('the key pair and the webhook secret are independent', () => {
  it('can create intents but not verify webhooks with only the key pair', () => {
    // The dangerous half-configured state: money can be taken, but no callback can be trusted,
    // so payments would sit PENDING after the customer has paid. Reported separately for
    // exactly this reason.
    process.env.APP_ENV = 'development';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_abc123';
    process.env.RAZORPAY_KEY_SECRET = 'secret-value';
    resetEnvCacheForTests();

    const resolved = resolvePaymentProvider();

    expect(resolved.name).toBe('razorpay');
    expect(resolved.provider.isConfigured()).toBe(true);
    expect(resolved.provider.canVerifyWebhooks()).toBe(false);
  });

  it('treats a key id with no secret as unconfigured', () => {
    process.env.APP_ENV = 'development';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_abc123';
    resetEnvCacheForTests();

    // Half a credential is not a credential; falling back is correct outside production.
    expect(resolvePaymentProvider().name).toBe('mock');
  });

  it('can verify webhooks with only the webhook secret', () => {
    process.env.APP_ENV = 'production';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret-value';
    resetEnvCacheForTests();

    const resolved = resolvePaymentProvider();

    expect(resolved.provider.isConfigured()).toBe(false);
    expect(resolved.provider.canVerifyWebhooks()).toBe(true);
  });
});
