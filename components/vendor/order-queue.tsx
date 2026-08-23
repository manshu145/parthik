'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/feedback/states';
import { Input } from '@/components/ui/input';
import { formatPaise, paise } from '@/lib/money';

/**
 * The vendor's order queue (docs/ROUTES.md §6).
 *
 * Client-rendered and polled, because a shop counter leaves this screen open all day: a new order
 * has to appear without anybody reloading, and a server-rendered page would only be as fresh as
 * the last refresh somebody remembered to do.
 *
 * ACTIONS ARE NAMED, NOT A STATUS DROPDOWN. The API exposes `accept`, `reject`, `preparing` and
 * `ready` rather than "set status", so this component cannot invent a transition the state machine
 * would refuse — and the button a vendor sees is always one that will work.
 */

const POLL_INTERVAL_MS = 15_000;

const TABS = ['new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'] as const;
type Tab = (typeof TABS)[number];

/** Which action each tab offers, so the buttons follow the queue rather than a status guess. */
const ACTIONS: Partial<Record<Tab, { action: string; labelKey: string }>> = {
  new: { action: 'accept', labelKey: 'actions.accept' },
  accepted: { action: 'preparing', labelKey: 'actions.startPreparing' },
  preparing: { action: 'ready', labelKey: 'actions.markReady' },
};

interface QueueItem {
  id: string;
  orderNumber: string;
  status: string;
  totalAmountPaise: number;
  itemCount: number;
  firstItemName: string;
  createdAt: string;
  isCod: boolean;
}

export function VendorOrderQueue() {
  const t = useTranslations('vendorOrders');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'hi';
  const format = useFormatter();

  const [tab, setTab] = useState<Tab>('new');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The order a rejection reason is being typed for. */
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(
    async (which: Tab) => {
      try {
        const response = await fetch(`/api/v1/vendor/orders?tab=${which}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });

        const payload = (await response.json()) as {
          success: boolean;
          data?: { items: QueueItem[] };
          error?: { message?: string };
        };

        if (!response.ok || !payload.success || !payload.data) {
          setError(payload.error?.message ?? tCommon('retry'));
          return;
        }

        setError(null);
        setItems(payload.data.items);
      } catch {
        setError(tCommon('retry'));
      } finally {
        setLoading(false);
      }
    },
    [tCommon]
  );

  useEffect(() => {
    let cancelled = false;
    // Scheduled rather than called inline: a state update reached synchronously from an effect
    // body causes a cascading render, and the lint rule rejects it.
    const first = setTimeout(() => void load(tab), 0);

    const timer = setInterval(() => {
      if (!cancelled && typeof document !== 'undefined' && !document.hidden) void load(tab);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, tab]);

  /** Runs a named action, then reloads so the row moves to the tab it now belongs to. */
  const act = useCallback(
    async (orderId: string, action: string, body?: Record<string, unknown>) => {
      setBusyId(orderId);
      setError(null);

      try {
        const response = await fetch(`/api/v1/vendor/orders/${orderId}/${action}`, {
          method: 'POST',
          ...(body
            ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
            : {}),
        });

        const payload = (await response.json()) as {
          success: boolean;
          error?: { message?: string };
        };

        if (!response.ok || !payload.success) {
          // The server's wording is used verbatim: it distinguishes "already moved on" from
          // "not allowed", and a vendor needs to know which.
          setError(payload.error?.message ?? tCommon('retry'));
          return;
        }

        setRejectingId(null);
        setReason('');
        await load(tab);
      } catch {
        setError(tCommon('retry'));
      } finally {
        setBusyId(null);
      }
    },
    [load, tab, tCommon]
  );

  const action = ACTIONS[tab];

  return (
    <div className="flex flex-col gap-4" data-testid="vendor-order-queue">
      <nav className="flex flex-wrap gap-2" aria-label={t('tabsLabel')}>
        {TABS.map((candidate) => (
          <Button
            key={candidate}
            size="sm"
            variant={candidate === tab ? 'primary' : 'secondary'}
            onClick={() => {
              setTab(candidate);
              setLoading(true);
            }}
            data-testid={`vendor-tab-${candidate}`}
          >
            {t(`tabs.${candidate}`)}
          </Button>
        ))}
      </nav>

      {error && <ErrorState title={tCommon('retry')} description={error} />}

      {isLoading ? (
        <LoadingState title={tCommon('loading')} />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="vendor-queue-empty">
          {t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card>
                <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium" data-testid="vendor-order-number">
                        {item.orderNumber}
                      </span>
                      {/* COD is flagged on the card: the packer needs to know cash is coming
                          back before the driver arrives, not after. */}
                      {item.isCod && <Badge variant="warning">{t('cod')}</Badge>}
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {t('itemSummary', { count: item.itemCount, name: item.firstItemName })}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {format.dateTime(new Date(item.createdAt), { timeStyle: 'short' })} ·{' '}
                      {formatPaise(paise(item.totalAmountPaise), locale)}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {action && (
                      <Button
                        size="sm"
                        onClick={() => void act(item.id, action.action)}
                        disabled={busyId === item.id}
                        data-testid={`vendor-action-${action.action}`}
                      >
                        {t(action.labelKey)}
                      </Button>
                    )}

                    {/* Rejection is only offered before the order is out of the shop's hands. */}
                    {(tab === 'new' || tab === 'accepted' || tab === 'preparing') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRejectingId(rejectingId === item.id ? null : item.id)}
                        disabled={busyId === item.id}
                        data-testid="vendor-action-reject-open"
                      >
                        {t('actions.reject')}
                      </Button>
                    )}
                  </div>

                  {rejectingId === item.id && (
                    <div className="flex w-full flex-col gap-2" data-testid="vendor-reject-form">
                      <p className="text-sm">{t('rejectPrompt')}</p>
                      <Input
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder={t('rejectPlaceholder')}
                        maxLength={300}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => void act(item.id, 'reject', { reason: reason.trim() })}
                          // Matches the API's minimum, so the button cannot submit something the
                          // server will refuse.
                          disabled={reason.trim().length < 3 || busyId === item.id}
                          data-testid="vendor-action-reject-confirm"
                        >
                          {t('actions.confirmReject')}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setRejectingId(null)}>
                          {tCommon('cancel')}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
