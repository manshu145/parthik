'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function CashDepositActions({
  depositId,
  status,
  declaredAmountPaise,
}: {
  depositId: string;
  status: string;
  declaredAmountPaise: number;
}) {
  const router = useRouter();
  const [verifiedRupees, setVerifiedRupees] = useState(String(declaredAmountPaise / 100));
  const [notes, setNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [mode, setMode] = useState<'verify' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'DECLARED') return null;

  async function verify() {
    const amount = Number(verifiedRupees);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter a valid counted amount.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/cash/deposits/' + depositId + '/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifiedAmountPaise: Math.round(amount * 100),
          notes: notes.trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Verification failed.');
      setMode(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (rejectReason.trim().length < 3) {
      setError('Enter a rejection reason.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/cash/deposits/' + depositId + '/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Rejection failed.');
      setMode(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rejection failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-64 space-y-2">
      {mode === null ? (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMode('verify')}>
            Verify
          </Button>
          <Button size="sm" variant="danger" onClick={() => setMode('reject')}>
            Reject
          </Button>
        </div>
      ) : null}

      {mode === 'verify' ? (
        <div className="space-y-2 rounded-lg border p-2">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={verifiedRupees}
            onChange={(event) => setVerifiedRupees(event.target.value)}
            disabled={busy}
            placeholder="Counted amount ₹"
          />
          <Input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={busy}
            maxLength={300}
            placeholder="Notes (optional)"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void verify()}>
              {busy ? 'Saving…' : 'Confirm count'}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'reject' ? (
        <div className="space-y-2 rounded-lg border p-2">
          <Input
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            disabled={busy}
            maxLength={300}
            placeholder="Reason"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void reject()}>
              {busy ? 'Rejecting…' : 'Confirm reject'}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-danger text-xs">{error}</p> : null}
    </div>
  );
}
