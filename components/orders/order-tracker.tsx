'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrderStatusBadge } from '@/components/orders/order-status-badge';
import { OrderTimeline } from '@/components/orders/order-timeline';
import {
  CUSTOMER_ORDER_STAGES,
  stageForStatus,
  type OrderStatusView,
  type OrderTimelineEventView,
} from '@/lib/order/view';

/**
 * Live order tracking by ADAPTIVE POLLING (D-22, docs/ROUTES.md §5).
 *
 * D-22 chose polling over websockets deliberately: a delivery status changes a handful of
 * times over half an hour, and a persistent connection per customer on Cloudflare Workers
 * costs far more than it saves. The cost of polling is entirely in the interval, so the
 * interval is the design:
 *
 *   OUT FOR DELIVERY   8s   — the only phase where the customer is actually watching
 *   other active       20s  — moving, but nothing changes minute to minute
 *   settled            stop — a delivered order will never change again, and polling it
 *                            forever is a bill with no upside
 *
 * It also stops while the tab is HIDDEN and gives up after repeated failures, offering a
 * manual retry. A tracker that hammers a failing endpoint from a background tab is how a
 * transient outage becomes a sustained one.
 */

const INTERVAL_OUT_FOR_DELIVERY_MS = 8_000;
const INTERVAL_ACTIVE_MS = 20_000;
/** After this many consecutive failures, stop and hand control back to the customer. */
const MAX_CONSECUTIVE_FAILURES = 4;

export interface TrackerSnapshot {
  status: OrderStatusView;
  isActive: boolean;
  estimatedDeliveryAt: string | Date | null;
  timeline: OrderTimelineEventView[];
}

function intervalFor(status: OrderStatusView): number {
  return status === 'OUT_FOR_DELIVERY' || status === 'PICKED_UP'
    ? INTERVAL_OUT_FOR_DELIVERY_MS
    : INTERVAL_ACTIVE_MS;
}

export function OrderTracker({
  orderId,
  orderNumber,
  initial,
}: {
  orderId: string;
  orderNumber: string;
  initial: TrackerSnapshot;
}) {
  const t = useTranslations('orders');
  const tCommon = useTranslations('common');
  const format = useFormatter();

  const [snapshot, setSnapshot] = useState(initial);
  const [failures, setFailures] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());

  const { status, isActive } = snapshot;
  const hasGivenUp = failures >= MAX_CONSECUTIVE_FAILURES;

  const poll = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/v1/orders/${orderId}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });

      const payload = (await response.json()) as {
        success: boolean;
        data?: {
          order: { status: OrderStatusView; estimatedDeliveryAt: string | null };
          timeline: OrderTimelineEventView[];
          isActive: boolean;
        };
      };

      if (!response.ok || !payload.success || !payload.data) {
        setFailures((count) => count + 1);
        return;
      }

      const data = payload.data;
      setSnapshot({
        status: data.order.status,
        isActive: data.isActive,
        estimatedDeliveryAt: data.order.estimatedDeliveryAt,
        timeline: data.timeline,
      });
      // Reset on success, so an isolated blip does not count toward giving up.
      setFailures(0);
      setLastUpdated(new Date());
    } catch {
      setFailures((count) => count + 1);
    }
  }, [orderId]);

  useEffect(() => {
    // A settled order will never change again. Not scheduling anything is the whole point of
    // the `isActive` flag coming from the server rather than being guessed here.
    if (!isActive || hasGivenUp) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      timer = setTimeout(() => {
        void tick();
      }, intervalFor(status));
    };

    const tick = async () => {
      if (cancelled) return;

      // Skipped, not fetched, while the tab is in the background: nobody is looking, and a
      // phone with ten backgrounded tabs polling every eight seconds is a battery complaint.
      if (typeof document !== 'undefined' && document.hidden) {
        schedule();
        return;
      }

      await poll();
      if (!cancelled) schedule();
    };

    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isActive, hasGivenUp, status, poll]);

  const currentStage = stageForStatus(status);
  const currentIndex = currentStage ? CUSTOMER_ORDER_STAGES.indexOf(currentStage) : -1;

  return (
    <div className="flex flex-col gap-4" data-testid="order-tracker">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">{orderNumber}</CardTitle>
          <OrderStatusBadge status={status} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/*
            Progress across the stages a CUSTOMER cares about, not the 14 internal statuses.
            A cancelled or failed order has no stage, so no bar is drawn — a progress bar on a
            cancelled order would imply it is still coming.
          */}
          {currentIndex >= 0 ? (
            <ol className="flex flex-col gap-2" data-testid="order-tracker-stages">
              {CUSTOMER_ORDER_STAGES.map((stage, index) => {
                const isDone = index < currentIndex;
                const isCurrent = index === currentIndex;

                return (
                  <li
                    key={stage}
                    className="flex items-center gap-3 text-sm"
                    data-testid={isCurrent ? 'order-tracker-current' : undefined}
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    <span
                      aria-hidden
                      className={
                        isDone || isCurrent
                          ? 'bg-success size-2.5 shrink-0 rounded-full'
                          : 'bg-muted size-2.5 shrink-0 rounded-full'
                      }
                    />
                    <span
                      className={
                        isCurrent ? 'font-medium' : isDone ? undefined : 'text-muted-foreground'
                      }
                    >
                      {t(`track.stage.${stage}`)}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-muted-foreground text-sm" data-testid="order-tracker-no-progress">
              {t('track.notInProgress')}
            </p>
          )}

          {snapshot.estimatedDeliveryAt && isActive && (
            <p className="text-sm" data-testid="order-tracker-eta">
              {t('track.eta', {
                time: format.dateTime(new Date(snapshot.estimatedDeliveryAt), {
                  timeStyle: 'short',
                }),
              })}
            </p>
          )}

          <p className="text-muted-foreground text-xs" data-testid="order-tracker-freshness">
            {hasGivenUp
              ? t('track.stopped')
              : isActive
                ? t('track.updated', {
                    time: format.dateTime(lastUpdated, { timeStyle: 'short' }),
                  })
                : t('track.settled')}
          </p>

          {/* A manual way forward once automatic polling has given up. Without it the page is
              simply stale with no indication that it will stay that way. */}
          {hasGivenUp && (
            <Button
              variant="secondary"
              onClick={() => {
                setFailures(0);
                void poll();
              }}
              data-testid="order-tracker-retry"
            >
              {tCommon('retry')}
            </Button>
          )}
        </CardContent>
      </Card>

      <OrderTimeline events={snapshot.timeline} />
    </div>
  );
}
