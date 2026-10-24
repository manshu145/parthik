'use client';

import { useCallback, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState } from '@/components/feedback/states';
import { OrderStatusBadge } from '@/components/orders/order-status-badge';
import { formatPaise, paise } from '@/lib/money';
import type { OrderListItemView } from '@/lib/order/view';

/**
 * Order history with KEYSET pagination (docs/ROUTES.md §5).
 *
 * The first page is server-rendered, so the customer's most recent order is in the HTML
 * rather than behind a spinner. Further pages come from `GET /api/v1/orders?cursor=…`.
 *
 * A cursor, not a page number: new orders arrive at the top, and with offset pagination the
 * second page would repeat a row the customer already saw every time that happened.
 */
export function OrderList({
  initialItems,
  initialCursor,
}: {
  initialItems: OrderListItemView[];
  initialCursor: string | null;
}) {
  const t = useTranslations('orders');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'hi';
  const format = useFormatter();

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (!cursor) return;

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/orders?cursor=${encodeURIComponent(cursor)}&limit=20`, {
        headers: { Accept: 'application/json' },
      });

      const payload = (await response.json()) as {
        success: boolean;
        data?: { items: OrderListItemView[]; nextCursor: string | null };
        error?: { message?: string };
      };

      if (!response.ok || !payload.success || !payload.data) {
        setError(payload.error?.message ?? tCommon('retry'));
        return;
      }

      /**
       * De-duplicated on append.
       *
       * The cursor is a timestamp, and two orders placed in the same millisecond would
       * otherwise appear twice — rare, but a duplicated React key breaks the list rather
       * than looking slightly wrong.
       */
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...payload.data!.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(payload.data.nextCursor);
    } catch {
      setError(tCommon('retry'));
    } finally {
      setPending(false);
    }
  }, [cursor, tCommon]);

  return (
    <div className="flex flex-col gap-4" data-testid="order-list">
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <Card>
              <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium" data-testid="order-number">
                      {item.orderNumber}
                    </span>
                    <OrderStatusBadge status={item.status} />
                    {item.isCod && <Badge variant="neutral">{t('card.cod')}</Badge>}
                  </div>

                  <p className="text-muted-foreground mt-1 truncate text-sm">
                    {item.firstItemName}
                    {item.itemCount > 1 && ` ${t('card.andMore', { count: item.itemCount - 1 })}`}
                  </p>

                  <p className="text-muted-foreground mt-1 text-xs">
                    {t('card.placedOn', {
                      date: format.dateTime(new Date(item.createdAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <span className="font-semibold" data-testid="order-total">
                    {formatPaise(paise(item.totalAmountPaise), locale)}
                  </span>
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/orders/${item.id}`}>{t('card.view')}</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {error && <ErrorState title={tCommon('retry')} description={error} />}

      {/* Rendered only when the server said another page exists, so there is no button that
          fetches an empty response. */}
      {cursor && (
        <Button
          variant="secondary"
          onClick={() => void loadMore()}
          disabled={pending}
          data-testid="order-list-load-more"
        >
          {pending ? tCommon('loading') : t('loadMore')}
        </Button>
      )}
    </div>
  );
}
