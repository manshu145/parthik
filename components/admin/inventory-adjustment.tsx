'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function InventoryAdjustment({
  inventoryId,
  disabled = false,
}: {
  inventoryId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const parsed = Number(delta);
    if (!Number.isInteger(parsed) || parsed === 0) {
      setError('Enter a non-zero whole-number adjustment.');
      return;
    }
    if (!reason.trim()) {
      setError('Enter an adjustment reason.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/actions/inventory/' + inventoryId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'adjust', delta: parsed, reason: reason.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Stock adjustment failed.');
      setDelta('');
      setReason('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Stock adjustment failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-64 space-y-2">
      <div className="flex gap-2">
        <Input
          type="number"
          step="1"
          value={delta}
          onChange={(event) => setDelta(event.target.value)}
          placeholder="+10 / -3"
          disabled={disabled || busy}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void submit()}
          disabled={disabled || busy}
        >
          {busy ? 'Saving…' : 'Adjust'}
        </Button>
      </div>
      <Input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason"
        maxLength={1000}
        disabled={disabled || busy}
      />
      {error ? (
        <p className="text-danger text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
