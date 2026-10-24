'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/feedback/states';
import { Input } from '@/components/ui/input';
import { formatPaise, paise } from '@/lib/money';

/**
 * The driver's working screen (docs/ROUTES.md §7).
 *
 * ONE SCREEN, not four, because a rider on a scooter should never have to find the right page.
 * It shows exactly one thing at a time: the availability toggle when there is no work, the offer
 * list when there is none accepted, and the active job — with the only button that matters next —
 * once one is taken.
 *
 * Polled rather than pushed (D-22). Offers expire and jobs get taken by other drivers, so the
 * list has to go stale on its own; a websocket per rider would cost far more than it saves for a
 * screen that changes a handful of times an hour.
 *
 * THE ORDER OF THE DELIVERY FORM IS DELIBERATE: cash first, then the code. A driver who types the
 * code first tends to submit before counting the money.
 */

const POLL_INTERVAL_MS = 10_000;

interface Offer {
  deliveryId: string;
  orderNumber: string;
  storeName: string;
  dropSummary: string;
  isCod: boolean;
  codExpectedPaise: number | null;
  deliveryFeePaise: number;
}

interface ActiveDelivery {
  delivery: {
    id: string;
    status: string;
    pickup: Record<string, unknown>;
    drop: Record<string, unknown>;
    codExpectedPaise: number | null;
    deliveryFeePaise: number;
    otpAttempts: number;
  } | null;
  order: {
    orderNumber: string;
    isCod: boolean;
    totalAmountPaise: number;
    contactName: string;
    contactPhone: string;
  } | null;
}

/** The one action each delivery status leads to. Never a menu. */
const NEXT_STEP: Record<string, { path: string; labelKey: string } | undefined> = {
  ASSIGNED: { path: 'reached-store', labelKey: 'steps.reachedStore' },
  EN_ROUTE_TO_STORE: { path: 'reached-store', labelKey: 'steps.reachedStore' },
  AT_STORE: { path: 'pickup', labelKey: 'steps.pickup' },
  PICKED_UP: { path: 'en-route', labelKey: 'steps.enRoute' },
  EN_ROUTE_TO_CUSTOMER: { path: 'reached-customer', labelKey: 'steps.reachedCustomer' },
};

export function DriverConsole() {
  const t = useTranslations('driverConsole');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'hi';

  const [availability, setAvailability] = useState<string>('OFFLINE');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [cashBlocked, setCashBlocked] = useState(false);
  const [active, setActive] = useState<ActiveDelivery>({ delivery: null, order: null });
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The handover form.
  const [otp, setOtp] = useState('');
  const [cashRupees, setCashRupees] = useState('');
  const [warning, setWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [activeResponse, offersResponse] = await Promise.all([
        fetch('/api/v1/driver/deliveries/active', { cache: 'no-store' }),
        fetch('/api/v1/driver/deliveries/available', { cache: 'no-store' }),
      ]);

      const activePayload = (await activeResponse.json()) as {
        success: boolean;
        data?: ActiveDelivery;
        error?: { message?: string };
      };

      if (!activeResponse.ok || !activePayload.success) {
        setError(activePayload.error?.message ?? tCommon('retry'));
        return;
      }

      setActive(activePayload.data ?? { delivery: null, order: null });

      const offersPayload = (await offersResponse.json()) as {
        success: boolean;
        data?: { offers: Offer[]; cashBlocked: boolean };
      };

      if (offersResponse.ok && offersPayload.success && offersPayload.data) {
        setOffers(offersPayload.data.offers);
        setCashBlocked(offersPayload.data.cashBlocked);
      }

      setError(null);
    } catch {
      setError(tCommon('retry'));
    } finally {
      setLoading(false);
    }
  }, [tCommon]);

  useEffect(() => {
    let cancelled = false;
    const first = setTimeout(() => void load(), 0);

    const timer = setInterval(() => {
      // Not while the phone is in a pocket: polling a backgrounded tab every ten seconds is a
      // battery complaint.
      if (!cancelled && typeof document !== 'undefined' && !document.hidden) void load();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const post = useCallback(
    async (path: string, body?: Record<string, unknown>) => {
      setBusy(true);
      setError(null);

      try {
        const response = await fetch(path, {
          method: path.includes('availability') ? 'PATCH' : 'POST',
          ...(body
            ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
            : {}),
        });

        const payload = (await response.json()) as {
          success: boolean;
          data?: Record<string, unknown>;
          error?: { message?: string };
        };

        if (!response.ok || !payload.success) {
          setError(payload.error?.message ?? tCommon('retry'));
          return null;
        }

        await load();
        return payload.data ?? {};
      } catch {
        setError(tCommon('retry'));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [load, tCommon]
  );

  const toggleAvailability = useCallback(async () => {
    const next = availability === 'ONLINE' ? 'OFFLINE' : 'ONLINE';
    const result = await post('/api/v1/driver/availability', { availability: next });
    if (result) setAvailability((result.availability as string) ?? next);
  }, [availability, post]);

  const completeDelivery = useCallback(async () => {
    setWarning(null);

    const isCod = active.order?.isCod ?? false;
    /**
     * Rupees in the box, paise on the wire.
     *
     * A driver types "1734", not "173400". Converting here rather than asking for paise is the
     * difference between a usable form and a hundredfold cash error.
     */
    const collectedPaise = isCod ? Math.round(Number(cashRupees) * 100) : null;

    const result = await post(`/api/v1/driver/deliveries/${active.delivery?.id}/deliver`, {
      otp,
      ...(isCod ? { codCollectedPaise: collectedPaise } : {}),
    });

    if (result) {
      setOtp('');
      setCashRupees('');
      // A mismatch is a completed delivery with something to settle later, so it is surfaced
      // here rather than treated as a failure.
      if (result.warning === 'COD_AMOUNT_MISMATCH') setWarning(t('cashMismatch'));
    }
  }, [active.delivery?.id, active.order?.isCod, cashRupees, otp, post, t]);

  /**
   * The wrapper renders on the FIRST frame, loading or not.
   *
   * Early-returning a bare loading state meant the container was absent from the server-rendered
   * HTML, so anything asserting on the screen — a check script, a Playwright test — saw a page
   * with no console on it.
   */
  if (isLoading) {
    return (
      <div data-testid="driver-console">
        <LoadingState title={tCommon('loading')} />
      </div>
    );
  }

  const delivery = active.delivery;
  const order = active.order;
  const step = delivery ? NEXT_STEP[delivery.status] : undefined;
  const canHandOver =
    delivery !== null &&
    ['PICKED_UP', 'EN_ROUTE_TO_CUSTOMER', 'AT_CUSTOMER'].includes(delivery.status);

  return (
    <div className="flex flex-col gap-4" data-testid="driver-console">
      {error && <ErrorState title={tCommon('retry')} description={error} />}

      {/* ---- Availability ---- */}
      {!delivery && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{t(availability === 'ONLINE' ? 'online' : 'offline')}</p>
              <p className="text-muted-foreground text-sm">{t('availabilityHint')}</p>
            </div>
            <Button
              onClick={() => void toggleAvailability()}
              disabled={busy}
              data-testid="driver-toggle"
            >
              {t(availability === 'ONLINE' ? 'goOffline' : 'goOnline')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/*
        The cash block, stated plainly.
        A driver over the float limit is excluded from COD offers by dispatch (D-18). Without this
        their screen would just be empty, which is the most confusing thing a delivery app can do
        to somebody waiting for work.
      */}
      {cashBlocked && !delivery && (
        <div
          className="border-warning bg-warning/10 rounded-[var(--radius-control)] border p-3 text-sm"
          data-testid="driver-cash-blocked"
        >
          {t('cashBlocked')}
        </div>
      )}

      {/* ---- The active job ---- */}
      {delivery && order ? (
        <Card data-testid="driver-active-delivery">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">{order.orderNumber}</CardTitle>
            <Badge variant={order.isCod ? 'warning' : 'neutral'}>
              {order.isCod ? t('collectCash') : t('prepaid')}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div>
              <p className="font-medium">{t('pickup')}</p>
              <p className="text-muted-foreground">{describe(delivery.pickup)}</p>
            </div>

            <div>
              <p className="font-medium">{t('drop')}</p>
              <p className="text-muted-foreground">{describe(delivery.drop)}</p>
              <p className="text-muted-foreground mt-1">
                {order.contactName} ·{' '}
                {/* A real link: a driver at a locked gate needs one tap, not a number to retype. */}
                <a className="underline" href={`tel:${order.contactPhone}`}>
                  {order.contactPhone}
                </a>
              </p>
            </div>

            {order.isCod && delivery.codExpectedPaise !== null && (
              <p className="font-medium" data-testid="driver-cod-expected">
                {t('cashToCollect', {
                  amount: formatPaise(paise(delivery.codExpectedPaise), locale),
                })}
              </p>
            )}

            {/* Exactly one forward button, decided by the status. */}
            {step && (
              <Button
                onClick={() => void post(`/api/v1/driver/deliveries/${delivery.id}/${step.path}`)}
                disabled={busy}
                data-testid={`driver-step-${step.path}`}
              >
                {t(step.labelKey)}
              </Button>
            )}

            {canHandOver && (
              <div
                className="border-border flex flex-col gap-3 border-t pt-3"
                data-testid="driver-handover"
              >
                <p className="font-medium">{t('handover')}</p>

                {order.isCod && (
                  <label className="flex flex-col gap-1">
                    <span className="text-sm">{t('cashCollectedLabel')}</span>
                    <Input
                      value={cashRupees}
                      onChange={(event) => setCashRupees(event.target.value)}
                      inputMode="decimal"
                      placeholder={t('cashCollectedPlaceholder')}
                      data-testid="driver-cash-input"
                    />
                  </label>
                )}

                <label className="flex flex-col gap-1">
                  <span className="text-sm">{t('otpLabel')}</span>
                  <Input
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    // A numeric keypad and a hard 6-digit cap: the OTP is six digits, and a
                    // mistyped fifth character would otherwise burn one of five attempts.
                    maxLength={6}
                    placeholder="000000"
                    data-testid="driver-otp-input"
                  />
                </label>

                {delivery.otpAttempts > 0 && (
                  <p className="text-muted-foreground text-xs" data-testid="driver-otp-attempts">
                    {t('otpAttempts', { used: delivery.otpAttempts })}
                  </p>
                )}

                <Button
                  onClick={() => void completeDelivery()}
                  disabled={busy || otp.length !== 6 || (order.isCod && cashRupees.trim() === '')}
                  data-testid="driver-complete"
                >
                  {t('completeDelivery')}
                </Button>

                {warning && (
                  <p className="text-warning text-sm" role="status" data-testid="driver-warning">
                    {warning}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        /* ---- Offers ---- */
        <div className="flex flex-col gap-3" data-testid="driver-offers">
          <p className="text-sm font-medium">{t('offersTitle')}</p>

          {offers.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="driver-offers-empty">
              {availability === 'ONLINE' ? t('noOffers') : t('offlineNoOffers')}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {offers.map((offer) => (
                <li key={offer.deliveryId}>
                  <Card>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                      <div>
                        <p className="font-medium">{offer.storeName}</p>
                        {/* Area and PIN only — an offer goes to every eligible driver, most of
                            whom will not take it. */}
                        <p className="text-muted-foreground">{offer.dropSummary}</p>
                        <p className="text-muted-foreground mt-1">
                          {offer.isCod
                            ? t('offerCod', {
                                amount: formatPaise(paise(offer.codExpectedPaise ?? 0), locale),
                              })
                            : t('offerPrepaid')}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          void post(`/api/v1/driver/deliveries/${offer.deliveryId}/accept`)
                        }
                        disabled={busy}
                        data-testid="driver-accept-offer"
                      >
                        {t('accept')}
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Reads an address snapshot defensively: it is a historical copy, not today's column set. */
function describe(snapshot: Record<string, unknown>): string {
  return ['name', 'line1', 'line2', 'landmark', 'city', 'pincode']
    .map((key) => snapshot[key])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .join(', ');
}
