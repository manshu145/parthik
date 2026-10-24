'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function PayoutActions({ payoutId, status }: { payoutId: string; status: string }) {
  const router = useRouter();
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: 'approve' | 'mark_paid' | 'fail') {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/actions/payout/' + payoutId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          referenceNumber: referenceNumber.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Payout action failed.');
      setReferenceNumber('');
      setNotes('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Payout action failed.');
    } finally {
      setBusy(null);
    }
  }

  if (status === 'PAID') return <span className="text-muted-foreground text-xs">Settled</span>;

  return (
    <div className="min-w-72 space-y-2">
      {status === 'APPROVED' ? (
        <Input
          value={referenceNumber}
          onChange={(event) => setReferenceNumber(event.target.value)}
          placeholder="Settlement reference"
          maxLength={160}
          disabled={busy !== null}
        />
      ) : null}
      <Input
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder={status === 'DRAFT' ? 'Notes (optional)' : 'Notes / failure reason'}
        maxLength={2000}
        disabled={busy !== null}
      />
      <div className="flex gap-2">
        {status === 'DRAFT' ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void run('approve')}
          >
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </Button>
        ) : null}
        {status === 'APPROVED' ? (
          <Button
            size="sm"
            disabled={busy !== null || !referenceNumber.trim()}
            onClick={() => void run('mark_paid')}
          >
            {busy === 'mark_paid' ? 'Saving…' : 'Mark paid'}
          </Button>
        ) : null}
        {(status === 'DRAFT' || status === 'APPROVED') && (
          <Button
            size="sm"
            variant="danger"
            disabled={busy !== null || !notes.trim()}
            onClick={() => void run('fail')}
          >
            {busy === 'fail' ? 'Saving…' : 'Mark failed'}
          </Button>
        )}
      </div>
      {error ? (
        <p className="text-danger text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
