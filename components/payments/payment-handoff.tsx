'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/feedback/states';
import { formatPaise, paise } from '@/lib/money';

/**
 * The gateway handoff (D-13, docs/ROUTES.md §5).
 *
 * THE RULE THIS COMPONENT EXISTS TO OBEY: **it never reports the outcome.** Razorpay's handler
 * fires in a browser the customer controls, so what it says is treated as a reason to ASK THE
 * SERVER, never as a result. The page only leaves this screen when
 * `GET /api/v1/payments/:id/status` — which verifies against the gateway server-side — says the
 * payment is no longer pending (docs/SECURITY.md §8.1 rule 2).
 *
 * It also keeps polling if the customer closes the gateway sheet, because the webhook may well
 * arrive anyway: a UPI collect request can be approved seconds after the modal is dismissed, and
 * abandoning the poll there would show a paid customer an unpaid order.
 *
 * With no Razorpay credentials the environment resolves to the mock gateway, and this says so
 * plainly rather than rendering a payment button that cannot work.
 */

const POLL_INTERVAL_MS = 3_000;
/** Stop after this long and hand control back, rather than spinning forever. */
const MAX_POLL_MS = 5 * 60_000;

interface ClientPayload {
  provider: string;
  keyId: string;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
}

interface RazorpayCheckout {
  open(): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

export function PaymentHandoff({
  orderId,
  orderNumber,
  amountPaise,
  customerName,
  customerPhone,
}: {
  orderId: string;
  orderNumber: string;
  amountPaise: number;
  customerName: string;
  customerPhone: string;
}) {
  const t = useTranslations('payments');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'hi';
  const router = useRouter();

  const [payload, setPayload] = useState<ClientPayload | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSettling, setSettling] = useState(false);
  const [hasGivenUp, setGivenUp] = useState(false);

  /**
   * The gateway's payment id, once it hands us one.
   *
   * A ref rather than state: it is an input to the next poll, not something the UI renders, and
   * making it state would restart the polling effect the moment it changed.
   */
  const providerPaymentId = useRef<string | null>(null);

  /** Creates the intent. Safe to call again — the server returns the same provider order. */
  const createIntent = useCallback(async () => {
    // NOTE: nothing sets state before the first `await`. A synchronous setState inside an
    // effect body triggers a cascading render, and the React compiler's lint rule rejects it.
    try {
      const response = await fetch('/api/v1/payments/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });

      const body = (await response.json()) as {
        success: boolean;
        data?: { payment: { id: string }; clientPayload: ClientPayload };
        error?: { message?: string };
      };

      if (!response.ok || !body.success || !body.data) {
        setError(body.error?.message ?? tCommon('retry'));
        return;
      }

      setError(null);
      setPaymentId(body.data.payment.id);
      setPayload(body.data.clientPayload);
    } catch {
      setError(tCommon('retry'));
    }
  }, [orderId, tCommon]);

  useEffect(() => {
    /**
     * Scheduled, not called inline.
     *
     * `react-hooks/set-state-in-effect` rejects a state update reached synchronously from an
     * effect body, and it is right to: it causes a cascading render. A zero-delay timer moves the
     * work to a task the effect merely starts, which is also cancellable on unmount — so a
     * customer who navigates away mid-request does not get a state update on a dead component.
     */
    const timer = setTimeout(() => void createIntent(), 0);
    return () => clearTimeout(timer);
  }, [createIntent]);

  /**
   * Polls the SERVER for the verdict.
   *
   * Started as soon as an intent exists, not only after the gateway calls back, because the
   * webhook can land before the browser does anything — and because the customer may complete a
   * UPI request on their phone after dismissing the sheet.
   */
  useEffect(() => {
    if (!paymentId || hasGivenUp) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled) return;

      try {
        const query = providerPaymentId.current
          ? `?providerPaymentId=${encodeURIComponent(providerPaymentId.current)}`
          : '';

        const response = await fetch(`/api/v1/payments/${paymentId}/status${query}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });

        const body = (await response.json()) as {
          success: boolean;
          data?: { status: string; isPending: boolean; failureMessage: string | null };
        };

        if (!cancelled && body.success && body.data && !body.data.isPending) {
          if (body.data.status === 'PAID') {
            setSettling(true);
            // The order page is the source of truth for what happens next.
            router.replace(`/orders/${orderId}`);
            return;
          }

          setError(body.data.failureMessage ?? t('failed'));
          setGivenUp(true);
          return;
        }
      } catch {
        // A single failed poll is not worth showing; the next one will either succeed or the
        // overall timeout will hand control back.
      }

      if (cancelled) return;

      if (Date.now() - startedAt > MAX_POLL_MS) {
        setGivenUp(true);
        return;
      }

      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [paymentId, hasGivenUp, orderId, router, t]);

  const openGateway = useCallback(() => {
    if (!payload) return;

    const open = () => {
      const Checkout = window.Razorpay;
      if (!Checkout) {
        setError(t('scriptFailed'));
        return;
      }

      const checkout = new Checkout({
        key: payload.keyId,
        order_id: payload.providerOrderId,
        amount: payload.amountPaise,
        currency: payload.currency,
        name: 'Parthik',
        description: orderNumber,
        prefill: { name: customerName, contact: customerPhone },
        theme: { color: '#0f766e' },
        handler: (result: { razorpay_payment_id?: string }) => {
          /**
           * NOT a confirmation — a HINT.
           *
           * The id is handed to the status endpoint, which fetches that payment from the gateway
           * and checks it belongs to this order and carries the right amount. Marking the order
           * paid from here would let anyone with the console open confirm their own order.
           */
          providerPaymentId.current = result.razorpay_payment_id ?? null;
          setSettling(true);
        },
        modal: {
          // Dismissing the sheet does not cancel the payment: a UPI request can still be
          // approved on the customer's phone, so polling continues.
          ondismiss: () => setSettling(false),
        },
      });

      checkout.open();
    };

    if (window.Razorpay) {
      open();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = open;
    script.onerror = () => setError(t('scriptFailed'));
    document.body.appendChild(script);
  }, [customerName, customerPhone, orderNumber, payload, t]);

  const isMockGateway = payload?.provider === 'mock';

  return (
    <Card data-testid="payment-handoff">
      <CardHeader>
        <CardTitle className="text-base">{t('title', { number: orderNumber })}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">
          {t('amountDue', { amount: formatPaise(paise(amountPaise), locale) })}
        </p>

        {!payload && !error && (
          <p className="text-muted-foreground text-sm" data-testid="payment-preparing">
            {t('preparing')}
          </p>
        )}

        {isMockGateway && (
          <div
            className="border-warning bg-warning/10 rounded-[var(--radius-control)] border p-3 text-sm"
            data-testid="payment-mock-gateway"
          >
            {/* Said out loud rather than shown as a broken button: this environment has no
                merchant account, and the order is real and waiting. */}
            <p className="font-medium">{t('mock.title')}</p>
            <p className="text-muted-foreground mt-1">{t('mock.description')}</p>
          </div>
        )}

        {payload && !isMockGateway && (
          <Button onClick={openGateway} disabled={isSettling} data-testid="payment-open-gateway">
            {isSettling ? t('verifying') : t('pay')}
          </Button>
        )}

        {isSettling && (
          <p className="text-muted-foreground text-sm" data-testid="payment-verifying">
            {/* The wait is deliberate and explained: we are asking the gateway, not trusting the
                browser. */}
            {t('verifyingNote')}
          </p>
        )}

        {error && <ErrorState title={t('problem')} description={error} />}

        {hasGivenUp && (
          <div className="flex flex-col gap-2" data-testid="payment-gave-up">
            <p className="text-muted-foreground text-sm">{t('timeout')}</p>
            <Button
              variant="secondary"
              onClick={() => {
                setGivenUp(false);
                setError(null);
                void createIntent();
              }}
            >
              {tCommon('retry')}
            </Button>
          </div>
        )}

        <p className="text-muted-foreground text-xs">{t('safeToLeave')}</p>
      </CardContent>
    </Card>
  );
}
