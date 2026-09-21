'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = {
  orderId: string;
  status: string;
  internalNote: string | null;
  nextStatuses: string[];
  canCancel: boolean;
  canNote: boolean;
  canRefund: boolean;
  totalAmountPaise: number;
};

export function AdminOrderOperations({
  orderId,
  status,
  internalNote,
  nextStatuses,
  canCancel,
  canNote,
  canRefund,
  totalAmountPaise,
}: Props) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState(internalNote ?? '');
  const [refundRupees, setRefundRupees] = useState(String(totalAmountPaise / 100));
  const [refundReason, setRefundReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/v1/admin/orders/' + orderId + '/action', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Order action failed.');
      setReason('');
      setMessage('Order updated.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Order action failed.');
    } finally {
      setBusy(null);
    }
  }

  async function refund() {
    const amount = Number(refundRupees);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid refund amount.');
      return;
    }
    if (refundReason.trim().length < 3) {
      setError('Enter a refund reason.');
      return;
    }

    setBusy('refund');
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/v1/admin/orders/' + orderId + '/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountPaise: Math.round(amount * 100),
          reason: refundReason.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Refund failed.');
      setMessage(
        payload?.data?.requiresManualPayout
          ? 'Refund recorded. Manual payout is required.'
          : 'Refund initiated successfully.'
      );
      setRefundReason('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Refund failed.');
    } finally {
      setBusy(null);
    }
  }

  const terminal = ['DELIVERED', 'CANCELLED', 'REFUNDED', 'RETURNED', 'FAILED_DELIVERY'].includes(
    status
  );

  return (
    <div className="space-y-4 rounded-xl border p-4" data-testid="admin-order-operations">
      <div>
        <p className="font-semibold">Order operations</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Only state-machine-approved transitions are shown.
        </p>
      </div>

      {nextStatuses.length > 0 ? (
        <div className="space-y-2">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason / operational note (when required)"
            maxLength={1000}
            disabled={busy !== null}
          />
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map((next) => (
              <Button
                key={next}
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void action({ action: 'transition', to: next, reason: reason.trim() || undefined }, next)}
              >
                {busy === next ? 'Working…' : 'Move to ' + next.replaceAll('_', ' ')}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {canCancel && !terminal ? (
        <Button
          size="sm"
          variant="danger"
          disabled={busy !== null || reason.trim().length < 3}
          onClick={() => void action({ action: 'cancel', reason: reason.trim() }, 'cancel')}
        >
          {busy === 'cancel' ? 'Cancelling…' : 'Cancel order'}
        </Button>
      ) : null}

      {canNote ? (
        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Internal note</p>
          <textarea
            className="border-input bg-background min-h-20 w-full rounded-md border p-3 text-sm"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={4000}
            disabled={busy !== null}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void action({ action: 'note', note: note.trim() || null }, 'note')}
          >
            {busy === 'note' ? 'Saving…' : 'Save internal note'}
          </Button>
        </div>
      ) : null}

      {canRefund ? (
        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Refund</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={refundRupees}
              onChange={(event) => setRefundRupees(event.target.value)}
              disabled={busy !== null}
              placeholder="Amount ₹"
            />
            <Input
              value={refundReason}
              onChange={(event) => setRefundReason(event.target.value)}
              disabled={busy !== null}
              maxLength={1000}
              placeholder="Refund reason"
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void refund()}
          >
            {busy === 'refund' ? 'Processing…' : 'Issue refund'}
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-danger text-sm" role="alert">{error}</p> : null}
      {message ? <p className="text-success text-sm">{message}</p> : null}
    </div>
  );
}
