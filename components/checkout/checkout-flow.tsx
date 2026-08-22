'use client';

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/feedback/states';
import { formatPaise, paise } from '@/lib/money';
import type {
  CheckoutAddressView,
  CheckoutBlockerView,
  CheckoutQuoteView,
  PaymentMethodView,
} from '@/lib/checkout/view';

/**
 * Checkout as a client flow over a SERVER-COMPUTED quote (master spec §12).
 *
 * The component holds selections — which address, which payment method — and nothing
 * else. Every figure on screen comes from `POST /api/v1/checkout/quote`, and the quote is
 * re-fetched whenever a selection changes rather than adjusted locally.
 *
 * That is the whole design: a delivery fee recalculated in the browser when the customer
 * picks a further address would disagree with the server the moment a rule changed, and the
 * customer would see one total and be charged another.
 */

export interface CheckoutFlowProps {
  initialQuote: CheckoutQuoteView;
  addresses: CheckoutAddressView[];
}

export function CheckoutFlow({ initialQuote, addresses }: CheckoutFlowProps) {
  const t = useTranslations('checkout');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'hi';

  const router = useRouter();

  const [quote, setQuote] = useState(initialQuote);
  const [addressId, setAddressId] = useState(initialQuote.address?.id ?? null);
  const [method, setMethod] = useState<PaymentMethodView | null>(initialQuote.selectedMethod);
  const [pending, setPending] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The idempotency key for the CURRENT attempt.
   *
   * Held in state rather than regenerated per click, so pressing "place order" again after a
   * timeout or a double-click replays the same request and gets the SAME order back instead of
   * creating a second one. Cleared whenever a selection changes, because a different address
   * or payment method is a genuinely different order and must not be answered with the
   * previous one.
   */
  const [attemptKey, setAttemptKey] = useState<string | null>(null);

  const money = useCallback((value: number) => formatPaise(paise(value), locale), [locale]);

  /** Re-quotes on the server. The only way any number here changes. */
  const requote = useCallback(
    async (selection: { addressId?: string | null; paymentMethod?: PaymentMethodView | null }) => {
      setPending(true);
      setError(null);

      try {
        const response = await fetch('/api/v1/checkout/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            addressId: selection.addressId ?? addressId,
            paymentMethod: selection.paymentMethod ?? method,
          }),
        });

        const payload = (await response.json()) as {
          success: boolean;
          data?: { quote: CheckoutQuoteView };
          error?: { message?: string };
        };

        if (!response.ok || !payload.success || !payload.data) {
          setError(payload.error?.message ?? tCommon('retry'));
          return;
        }

        const confirmed = payload.data.quote;

        /**
         * The selections are re-read FROM THE RESPONSE, not left as the customer set them.
         *
         * The server may refuse a choice — an unavailable payment method comes back as
         * `selectedMethod: null` — and the UI has to show what was actually accepted. Done
         * here rather than in an effect so there is one source of truth per render and no
         * frame where the radio disagrees with the total beside it.
         */
        setQuote(confirmed);
        setMethod(confirmed.selectedMethod);
        if (confirmed.address?.id) setAddressId(confirmed.address.id);
      } catch {
        setError(tCommon('retry'));
      } finally {
        setPending(false);
      }
    },
    [addressId, method, tCommon]
  );

  const chooseAddress = (id: string) => {
    // Optimistic, so the radio responds immediately; corrected from the response above.
    setAddressId(id);
    setAttemptKey(null);
    void requote({ addressId: id });
  };

  const chooseMethod = (next: PaymentMethodView) => {
    setMethod(next);
    setAttemptKey(null);
    void requote({ paymentMethod: next });
  };

  /**
   * Places the order.
   *
   * Sends only CHOICES — the address, the method and the idempotency key. No amount, no line
   * and no total: everything monetary is recomputed inside the creating transaction, so there
   * is nothing here a modified client could send that would change what the order costs.
   */
  const placeOrder = useCallback(async () => {
    const key = attemptKey ?? `web-${crypto.randomUUID()}`;
    if (!attemptKey) setAttemptKey(key);

    setPlacing(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: key, addressId, paymentMethod: method }),
      });

      const payload = (await response.json()) as {
        success: boolean;
        data?: { order: { id: string } };
        error?: { message?: string };
      };

      if (!response.ok || !payload.success || !payload.data) {
        setError(payload.error?.message ?? tCommon('retry'));
        /**
         * Re-quote after a refusal.
         *
         * The most common failure is something that CHANGED — an item sold out, the store
         * closed — so the blockers on screen are now out of date. Refreshing them turns a
         * bare error message into a page that shows what to fix.
         */
        void requote({});
        return;
      }

      /**
       * A prepaid order lands on its own page in PENDING_PAYMENT rather than on an invented
       * payment screen. The payment step is TASK 011; until it exists, showing the customer an
       * honest "awaiting payment" order is better than a route that cannot complete.
       */
      router.push(`/orders/${payload.data.order.id}`);
    } catch {
      setError(tCommon('retry'));
    } finally {
      setPlacing(false);
    }
  }, [addressId, attemptKey, method, requote, router, tCommon]);

  const totals = quote.cart.totals;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]" data-testid="checkout-flow">
      <div className="flex flex-col gap-6">
        {/* ---- Address ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('steps.address')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {addresses.length === 0 ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-muted-foreground text-sm">{t('address.none')}</p>
                <Button asChild size="sm">
                  <Link href="/account/addresses">{t('address.add')}</Link>
                </Button>
              </div>
            ) : (
              <>
                <fieldset className="flex flex-col gap-2" disabled={pending}>
                  <legend className="sr-only">{t('address.choose')}</legend>

                  {addresses.map((address) => (
                    <label
                      key={address.id}
                      className="border-border hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border p-3 has-[:checked]:border-[var(--color-ring)]"
                      data-testid="checkout-address-option"
                    >
                      <input
                        type="radio"
                        name="addressId"
                        value={address.id}
                        checked={addressId === address.id}
                        onChange={() => chooseAddress(address.id)}
                        className="mt-1"
                        // An unserviceable address cannot be delivered to, so it is not
                        // selectable — better than accepting it and blocking at the end.
                        disabled={!address.isServiceable || pending}
                      />
                      <span className="flex-1 text-sm">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {address.label ?? address.recipientName}
                          {address.isDefault && (
                            <Badge variant="neutral">{t('address.default')}</Badge>
                          )}
                          {!address.isServiceable && (
                            <Badge variant="warning">{t('address.unserviceable')}</Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground mt-1 block">
                          {[address.line1, address.line2, address.landmark, address.city]
                            .filter(Boolean)
                            .join(', ')}{' '}
                          — {address.pincode}
                        </span>
                        <span className="text-muted-foreground mt-1 block">
                          {address.recipientName} · {address.recipientPhone}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>

                <Link
                  href="/account/addresses"
                  className="text-muted-foreground text-sm underline underline-offset-4"
                >
                  {t('address.manage')}
                </Link>
              </>
            )}
          </CardContent>
        </Card>

        {/* ---- Payment ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('steps.payment')}</CardTitle>
          </CardHeader>
          <CardContent>
            <fieldset className="flex flex-col gap-2" disabled={pending}>
              <legend className="sr-only">{t('payment.choose')}</legend>

              {quote.paymentMethods.map((option) => (
                <label
                  key={option.method}
                  className="border-border flex items-start gap-3 rounded-[var(--radius-control)] border p-3 has-[:checked]:border-[var(--color-ring)] has-[:disabled]:opacity-60"
                  data-testid="checkout-payment-option"
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={option.method}
                    checked={method === option.method}
                    onChange={() => chooseMethod(option.method)}
                    disabled={!option.isAvailable || pending}
                    className="mt-1"
                  />
                  <span className="flex-1 text-sm">
                    <span className="font-medium">{t(`payment.${option.method}`)}</span>

                    {/* A reason, not just a disabled control. "COD unavailable" with no
                        explanation is a support ticket. */}
                    {option.rejection && (
                      <span className="text-muted-foreground mt-1 block">
                        {option.rejection.code === 'COD_ORDER_VALUE_TOO_HIGH'
                          ? t('payment.unavailable.COD_ORDER_VALUE_TOO_HIGH', {
                              max: money(option.rejection.maxOrderValuePaise),
                            })
                          : t(`payment.unavailable.${option.rejection.code}`)}
                      </span>
                    )}

                    {option.method === 'COD' && option.isAvailable && method === 'COD' && (
                      <span className="text-muted-foreground mt-1 block">
                        {t('payment.codNote', { amount: money(quote.totalPaise) })}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
          </CardContent>
        </Card>
      </div>

      {/* ---- Summary ---- */}
      <aside className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('summary.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Row
              label={`${t('summary.items')} (${totals.itemCount})`}
              value={money(totals.grossAmountPaise)}
            />

            {totals.itemDiscountPaise > 0 && (
              <Row
                label={t('summary.itemSavings')}
                value={`− ${money(totals.itemDiscountPaise)}`}
                tone="positive"
              />
            )}

            {quote.cart.coupon?.isApplied && totals.couponDiscountPaise > 0 && (
              <Row
                label={t('summary.coupon', { code: quote.cart.coupon.code })}
                value={`− ${money(totals.couponDiscountPaise)}`}
                tone="positive"
              />
            )}

            <Row
              label={t('summary.delivery')}
              value={quote.isFreeDelivery ? t('summary.free') : money(quote.deliveryFeePaise)}
              tone={quote.isFreeDelivery ? 'positive' : undefined}
            />

            {/*
              NO TAX ROW. D-14 is blocked, so no tax treatment is asserted — not even a
              zero one, because "₹0 GST" is itself a claim (docs/ARCHITECTURE.md §11.2.2).
              The notice below says plainly that no invoice is issued.
            */}

            <div className="border-border mt-2 flex items-center justify-between border-t pt-2 text-base font-semibold">
              <span>{t('summary.total')}</span>
              <span data-testid="checkout-total">{money(quote.totalPaise)}</span>
            </div>

            {quote.etaMinMinutes !== null && quote.etaMaxMinutes !== null && (
              <p className="text-muted-foreground pt-1 text-xs">
                {t('summary.eta', { min: quote.etaMinMinutes, max: quote.etaMaxMinutes })}
              </p>
            )}

            <p className="text-muted-foreground pt-1 text-xs">{t('summary.noTaxNotice')}</p>
          </CardContent>
        </Card>

        {/* Blockers, each naming the step to go back to. */}
        {quote.blockers.length > 0 && (
          <ul className="flex flex-col gap-2" data-testid="checkout-blockers">
            {quote.blockers.map((blocker, index) => (
              <li
                key={`${blocker.code}-${index}`}
                className="border-warning bg-warning/10 rounded-[var(--radius-control)] border p-3 text-sm"
              >
                {describeBlocker(blocker, t, money)}
              </li>
            ))}
          </ul>
        )}

        {error && <ErrorState title={tCommon('retry')} description={error} />}

        <Button
          className="w-full"
          size="lg"
          onClick={() => void placeOrder()}
          // `canPlaceOrder` is the SERVER's verdict on the current quote, not a local check.
          disabled={!quote.canPlaceOrder || pending || placing}
          data-testid="checkout-place-order"
        >
          {placing ? t('placing') : t('placeOrder')}
        </Button>

        <Button asChild variant="secondary" className="w-full">
          <Link href="/cart">{t('backToCart')}</Link>
        </Button>
      </aside>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'positive' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={tone === 'positive' ? 'text-success' : undefined}>{value}</span>
    </div>
  );
}

type Translator = ReturnType<typeof useTranslations<'checkout'>>;

/** Turns a typed blocker into copy, using the detail each one carries. */
function describeBlocker(
  blocker: CheckoutBlockerView,
  t: Translator,
  money: (value: number) => string
): string {
  switch (blocker.code) {
    case 'NOT_SERVICEABLE':
      return t('blockers.NOT_SERVICEABLE', { pincode: blocker.pincode });
    case 'MIN_ORDER_NOT_MET':
      return t('blockers.MIN_ORDER_NOT_MET', {
        min: money(blocker.minOrderPaise),
        shortfall: money(blocker.shortfallPaise),
      });
    default:
      return t(`blockers.${blocker.code}`);
  }
}
