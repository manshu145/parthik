'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

type DriverOption = { id: string; label: string };

export function DeliveryAssignment({
  deliveryId,
  currentDriverId,
  drivers,
  disabled = false,
}: {
  deliveryId: string;
  currentDriverId: string | null;
  drivers: DriverOption[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [driverId, setDriverId] = useState(currentDriverId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (!driverId) {
      setError('Choose an approved driver.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/actions/delivery/' + deliveryId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assign', driverId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Assignment failed.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Assignment failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-64">
      <div className="flex gap-2">
        <select
          className="border-input bg-background h-9 min-w-40 rounded-md border px-2 text-xs"
          value={driverId}
          onChange={(event) => setDriverId(event.target.value)}
          disabled={disabled || busy}
        >
          <option value="">Choose driver</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void assign()}
          disabled={disabled || busy}
        >
          {busy ? 'Assigning…' : currentDriverId ? 'Reassign' : 'Assign'}
        </Button>
      </div>
      {error ? (
        <p className="text-danger mt-1 text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
