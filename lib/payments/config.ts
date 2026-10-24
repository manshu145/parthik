import { getServerEnv } from '@/lib/config/env';
import { ConfigurationError } from '@/lib/errors';

/**
 * Razorpay credential access (D-13).
 *
 * MISSING CREDENTIALS ARE NOT A CRASH. Same trio as `lib/firebase/config.ts`: a nullable
 * getter for graceful degradation and health reporting, a boolean for feature gating, and a
 * `require*` that throws a typed `ConfigurationError` at the point of use. A fresh clone with
 * no merchant account must still boot, still serve the catalogue, and still take COD orders.
 *
 * THE KEY PAIR AND THE WEBHOOK SECRET ARE REPORTED SEPARATELY, because they fail for
 * different reasons and the surfaces that break are different. Without the key pair you
 * cannot create an intent, so prepaid checkout is unavailable. Without the webhook secret you
 * cannot TRUST a callback, so payments would sit at PENDING forever — a far more dangerous
 * state, since the customer has been charged. Collapsing them into one "is Razorpay
 * configured?" boolean would make a half-configured deployment silently take money it cannot
 * confirm.
 */

export interface RazorpayKeyPair {
  keyId: string;
  keySecret: string;
}

export function getRazorpayKeyPairOrNull(): RazorpayKeyPair | null {
  const env = getServerEnv();

  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return null;

  return { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET };
}

export function isRazorpayKeyPairConfigured(): boolean {
  return getRazorpayKeyPairOrNull() !== null;
}

export function requireRazorpayKeyPair(): RazorpayKeyPair {
  const pair = getRazorpayKeyPairOrNull();

  if (!pair) {
    throw new ConfigurationError(
      'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to accept prepaid payments; cash on delivery works without them.'
    );
  }

  return pair;
}

export function getRazorpayWebhookSecretOrNull(): string | null {
  return getServerEnv().RAZORPAY_WEBHOOK_SECRET ?? null;
}

export function isRazorpayWebhookSecretConfigured(): boolean {
  return getRazorpayWebhookSecretOrNull() !== null;
}

export function requireRazorpayWebhookSecret(): string {
  const secret = getRazorpayWebhookSecretOrNull();

  if (!secret) {
    throw new ConfigurationError(
      'RAZORPAY_WEBHOOK_SECRET is not configured, so payment callbacks cannot be verified. An unverified callback is never trusted, so payments would stay PENDING after the customer has paid.'
    );
  }

  return secret;
}
