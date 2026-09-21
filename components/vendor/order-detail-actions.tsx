'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type OrderStatus = 'CONFIRMED' | 'ACCEPTED' | 'PREPARING' | string;

export function VendorOrderDetailActions({
  orderId,
  status,
}: {
  orderId: string;
  status: OrderStatus;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const primary =
    status === 'CONFIRMED'
      ? { action: 'accept', label: 'Accept order' }
      : status === 'ACCEPTED'
        ? { action: 'preparing', label: 'Start preparing' }
        : status === 'PREPARING'
          ? { action: 'ready', label: 'Mark ready for pickup' }
          : null;

  const canReject = status === 'CONFIRMED' || status === 'ACCEPTED' || status === 'PREPARING';

  if (!primary && !canReject) return null;

  async function run(action: string, body?: Record<string, unknown>) {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch('/api/v1/vendor/orders/' + orderId + '/' + action, {
        method: 'POST',
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload?.error?.message ?? 'Order action failed.');
      }

      setReason('');
      setShowReject(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Order action failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border p-4" data-testid="vendor-order-detail-actions">
      <p className="text-sm font-semibold">Order actions</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {primary ? (
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() => void run(primary.action)}
          >
            {busy === primary.action ? 'Working…' : primary.label}
          </Button>
        ) : null}
        {canReject ? (
          <Button
            size="sm"
            variant="danger"
            disabled={busy !== null}
            onClick={() => setShowReject((value) => !value)}
          >
            Reject order
          </Button>
        ) : null}
      </div>

      {showReject ? (
        <div className="mt-3 flex flex-col gap-2">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for rejection"
            maxLength={300}
            disabled={busy !== null}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={busy !== null || reason.trim().length < 3}
              onClick={() => void run('reject', { reason: reason.trim() })}
            >
              {busy === 'reject' ? 'Rejecting…' : 'Confirm rejection'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                setShowReject(false);
                setReason('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-danger mt-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
