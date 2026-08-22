'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { OrderTimelineEventView } from '@/lib/order/view';

/**
 * The order's history, exactly as recorded.
 *
 * Rendered from `order_status_history` rather than inferred from timestamps on the order, and
 * that distinction matters: the history has a row for EVERY transition including the ones
 * that went backwards or were made by an admin, and a reason attached to each. An inferred
 * timeline would quietly hide the interesting cases — the reassignment, the failed delivery
 * attempt, the manual intervention — which are the only ones anyone ever asks about.
 */
export function OrderTimeline({ events }: { events: OrderTimelineEventView[] }) {
  const t = useTranslations('orders');
  const format = useFormatter();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('detail.timeline')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-4" data-testid="order-timeline">
          {/* Newest first: the current state is what the customer opened the page to see. */}
          {[...events].reverse().map((event) => (
            <li key={event.id} className="flex gap-3">
              <span aria-hidden className="bg-muted mt-1.5 size-2 shrink-0 rounded-full" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{t(`status.${event.toStatus}`)}</p>
                <p className="text-muted-foreground text-xs">
                  {format.dateTime(new Date(event.createdAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
                {/* The reason is the whole value of the row for a cancellation or a failed
                    attempt, so it is shown rather than kept for support only. */}
                {event.reason && (
                  <p className="text-muted-foreground mt-1 text-xs">{event.reason}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
