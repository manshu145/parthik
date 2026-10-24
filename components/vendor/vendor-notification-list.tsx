'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

type VendorNotification = {
  id: string;
  title: string | null;
  body: string;
  channel: string;
  status: string;
  readAt: string | null;
  createdAt: string;
};

export function VendorNotificationList({
  locale,
  rows,
}: {
  locale: string;
  rows: VendorNotification[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dateLocale = locale === 'hi' ? 'hi-IN' : 'en-IN';

  async function markRead(notificationId: string) {
    setBusyId(notificationId);
    setError(null);

    try {
      const response = await fetch(
        `/api/v1/vendor/notifications/${encodeURIComponent(notificationId)}`,
        { method: 'PATCH' }
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error?.message ?? 'Could not mark this notification as read.');
      }

      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update this notification.');
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        {locale === 'hi' ? 'अभी कोई notification नहीं है।' : 'No notifications yet.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="vendor-notification-list">
      {error ? (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {rows.map((row) => (
        <article
          key={row.id}
          className={`rounded-xl border p-4 ${row.readAt ? 'bg-background' : 'bg-muted/30'}`}
          data-testid="vendor-notification"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-medium">{row.title ?? row.channel}</h2>
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {row.readAt
                    ? locale === 'hi'
                      ? 'पढ़ा गया'
                      : 'Read'
                    : locale === 'hi'
                      ? 'अपठित'
                      : 'Unread'}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{row.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {row.channel} · {row.status} ·{' '}
                {new Intl.DateTimeFormat(dateLocale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(row.createdAt))}
              </p>
            </div>

            {!row.readAt ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={busyId !== null}
                onClick={() => void markRead(row.id)}
              >
                {busyId === row.id
                  ? locale === 'hi'
                    ? 'अपडेट हो रहा है…'
                    : 'Saving…'
                  : locale === 'hi'
                    ? 'पढ़ा हुआ चिह्नित करें'
                    : 'Mark as read'}
              </Button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
