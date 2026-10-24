'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type StoreStatus = 'OPEN' | 'CLOSED' | 'TEMPORARILY_CLOSED';

export function StoreControls({
  store,
}: {
  store: {
    id: string;
    status: string;
    description: string | null;
    deliveryRadiusKm: number | null;
    codEnabled: boolean;
    minOrderPaise: number;
    avgPrepTimeMinutes: number | null;
    isAcceptingOrders: boolean;
  };
}) {
  const router = useRouter();
  const [status, setStatus] = useState<StoreStatus>(
    store.status === 'OPEN' || store.status === 'TEMPORARILY_CLOSED' ? store.status : 'CLOSED'
  );
  const [description, setDescription] = useState(store.description ?? '');
  const [deliveryRadiusKm, setDeliveryRadiusKm] = useState(
    store.deliveryRadiusKm === null ? '' : String(store.deliveryRadiusKm)
  );
  const [codEnabled, setCodEnabled] = useState(store.codEnabled);
  const [minOrderRupees, setMinOrderRupees] = useState(String(store.minOrderPaise / 100));
  const [avgPrepTimeMinutes, setAvgPrepTimeMinutes] = useState(
    store.avgPrepTimeMinutes === null ? '' : String(store.avgPrepTimeMinutes)
  );
  const [isAcceptingOrders, setIsAcceptingOrders] = useState(store.isAcceptingOrders);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const minOrder = Number(minOrderRupees);
    const radius = deliveryRadiusKm.trim() ? Number(deliveryRadiusKm) : null;
    const prep = avgPrepTimeMinutes.trim() ? Number(avgPrepTimeMinutes) : null;

    if (!Number.isFinite(minOrder) || minOrder < 0) {
      setError('Minimum order must be zero or higher.');
      return;
    }
    if (radius !== null && (!Number.isInteger(radius) || radius < 1 || radius > 100)) {
      setError('Delivery radius must be between 1 and 100 km.');
      return;
    }
    if (prep !== null && (!Number.isInteger(prep) || prep < 1 || prep > 240)) {
      setError('Preparation time must be between 1 and 240 minutes.');
      return;
    }

    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch('/api/v1/vendor/stores/' + store.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          description: description.trim() || null,
          deliveryRadiusKm: radius,
          codEnabled,
          minOrderPaise: Math.round(minOrder * 100),
          avgPrepTimeMinutes: prep,
          isAcceptingOrders: status === 'OPEN' ? isAcceptingOrders : false,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Store update failed.');

      setMessage('Store configuration saved.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Store update failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <p className="text-sm font-semibold">Store controls</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Status</span>
          <select
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
            value={status}
            onChange={(event) => {
              const value = event.target.value as StoreStatus;
              setStatus(value);
              if (value !== 'OPEN') setIsAcceptingOrders(false);
            }}
            disabled={busy}
          >
            <option value="OPEN">OPEN</option>
            <option value="CLOSED">CLOSED</option>
            <option value="TEMPORARILY_CLOSED">TEMPORARILY CLOSED</option>
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Minimum order (₹)</span>
          <Input
            type="number"
            min="0"
            step="1"
            value={minOrderRupees}
            onChange={(event) => setMinOrderRupees(event.target.value)}
            disabled={busy}
          />
        </label>

        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Prep time (minutes)</span>
          <Input
            type="number"
            min="1"
            max="240"
            step="1"
            value={avgPrepTimeMinutes}
            onChange={(event) => setAvgPrepTimeMinutes(event.target.value)}
            disabled={busy}
          />
        </label>

        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Delivery radius (km)</span>
          <Input
            type="number"
            min="1"
            max="100"
            step="1"
            value={deliveryRadiusKm}
            onChange={(event) => setDeliveryRadiusKm(event.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      <label className="space-y-1 text-xs">
        <span className="text-muted-foreground">Description</span>
        <textarea
          className="border-input bg-background min-h-20 w-full rounded-md border p-3 text-sm"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2000}
          disabled={busy}
        />
      </label>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={codEnabled}
            onChange={(event) => setCodEnabled(event.target.checked)}
            disabled={busy}
          />
          COD enabled
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isAcceptingOrders}
            onChange={(event) => setIsAcceptingOrders(event.target.checked)}
            disabled={busy || status !== 'OPEN'}
          />
          Accepting orders
        </label>
      </div>

      {error ? (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="text-success text-sm">{message}</p> : null}

      <Button size="sm" onClick={() => void save()} disabled={busy}>
        {busy ? 'Saving…' : 'Save store'}
      </Button>
    </div>
  );
}
