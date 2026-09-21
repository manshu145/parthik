'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Address = { id: string; label: string | null; addressType: string; recipientName: string; recipientPhone: string; line1: string; line2: string | null; landmark: string | null; city: string; state: string; pincode: string; isDefault: boolean; isServiceable?: boolean };

const EMPTY = { label: 'Home', addressType: 'HOME', recipientName: '', recipientPhone: '', line1: '', line2: '', landmark: '', city: '', state: '', pincode: '', deliveryInstructions: '', isDefault: false };

export function AddressBook() {
  const [items, setItems] = useState<Address[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/v1/addresses', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not load addresses.');
    setItems(payload.data.addresses);
  }, []);

  // The address API is the external source of truth; the initial request hydrates
  // this interactive manager after the authenticated shell mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load addresses.')); }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await fetch('/api/v1/addresses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not save address.');
      setForm(EMPTY); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save address.'); } finally { setBusy(false); }
  }

  async function mutate(id: string, method: 'PATCH' | 'DELETE') {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/v1/addresses/${id}`, { method });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Address update failed.');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Address update failed.'); } finally { setBusy(false); }
  }

  const field = (name: keyof typeof EMPTY, label: string, required = false) => (
    <label className="space-y-1 text-sm"><span>{label}</span><Input value={String(form[name])} required={required} disabled={busy} onChange={(event) => setForm((value) => ({ ...value, [name]: event.target.value }))} /></label>
  );

  return <div className="grid gap-6 lg:grid-cols-2">
    <section className="space-y-3">
      {items.length === 0 ? <p className="text-muted-foreground text-sm">No saved addresses.</p> : items.map((item) => <article key={item.id} className="rounded-xl border p-4 text-sm">
        <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.label ?? item.addressType}{item.isDefault ? ' · Default' : ''}</p><p className="mt-1">{item.recipientName} · {item.recipientPhone}</p><p className="text-muted-foreground mt-1">{item.line1}{item.line2 ? `, ${item.line2}` : ''}, {item.city}, {item.state} {item.pincode}</p></div><span className={item.isServiceable === false ? 'text-danger text-xs' : 'text-success text-xs'}>{item.isServiceable === false ? 'Not serviceable' : 'Serviceable'}</span></div>
        <div className="mt-3 flex gap-2">{!item.isDefault ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void mutate(item.id, 'PATCH')}>Make default</Button> : null}<Button size="sm" variant="secondary" disabled={busy} onClick={() => void mutate(item.id, 'DELETE')}>Delete</Button></div>
      </article>)}
    </section>
    <form onSubmit={create} className="space-y-3 rounded-xl border p-4"><h2 className="font-semibold">Add address</h2><div className="grid gap-3 sm:grid-cols-2">{field('label', 'Label')}{field('recipientName', 'Recipient name', true)}{field('recipientPhone', 'Mobile number', true)}{field('pincode', 'PIN code', true)}</div>{field('line1', 'House, street and area', true)}{field('line2', 'Address line 2')}{field('landmark', 'Landmark')}<div className="grid gap-3 sm:grid-cols-2">{field('city', 'City', true)}{field('state', 'State', true)}</div>{field('deliveryInstructions', 'Delivery instructions')}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isDefault} onChange={(event) => setForm((value) => ({ ...value, isDefault: event.target.checked }))} />Make default</label>{error ? <p className="text-danger text-sm" role="alert">{error}</p> : null}<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save address'}</Button></form>
  </div>;
}
