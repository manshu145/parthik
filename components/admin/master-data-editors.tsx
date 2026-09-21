'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type CategoryRow = {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  isFeatured: boolean;
};

export function CategoryEditor({
  rows,
}: {
  rows: CategoryRow[];
}) {
  const router = useRouter();
  const empty = {
    name: '',
    slug: '',
    description: '',
    parentId: '',
    displayOrder: '0',
    isActive: true,
    isFeatured: false,
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(row: CategoryRow) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      slug: row.slug,
      description: row.description ?? '',
      parentId: row.parentId ?? '',
      displayOrder: String(row.displayOrder),
      isActive: row.isActive,
      isFeatured: row.isFeatured,
    });
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        '/api/v1/admin/config/category' + (editingId ? '/' + editingId : ''),
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            slug: form.slug.trim().toLowerCase(),
            description: form.description.trim() || null,
            parentId: form.parentId || null,
            displayOrder: Number(form.displayOrder) || 0,
            isActive: form.isActive,
            isFeatured: form.isFeatured,
          }),
        }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Category save failed.');
      setEditingId(null);
      setForm(empty);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Category save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <form onSubmit={save} className="space-y-3 rounded-xl border p-4">
        <p className="font-semibold">{editingId ? 'Edit category' : 'Create category'}</p>
        <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" />
        <Input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="slug" />
        <textarea className="border-input bg-background min-h-20 w-full rounded-md border p-3 text-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" />
        <select className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
          <option value="">Root category</option>
          {rows.filter((row) => !row.parentId && row.id !== editingId).map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
        <Input type="number" min="0" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} placeholder="Display order" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Active</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} />Featured</label>
        {error ? <p className="text-danger text-sm">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          {editingId ? <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingId(null); setForm(empty); }}>Cancel</Button> : null}
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr><th className="px-4 py-3">Category</th><th className="px-4 py-3">Parent</th><th className="px-4 py-3">Order</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3"><p className="font-medium">{row.name}</p><p className="text-muted-foreground text-xs">/{row.slug}</p></td>
                <td className="px-4 py-3">{rows.find((candidate) => candidate.id === row.parentId)?.name ?? 'Root'}</td>
                <td className="px-4 py-3">{row.displayOrder}</td>
                <td className="px-4 py-3">{row.isActive ? 'ACTIVE' : 'INACTIVE'}{row.isFeatured ? ' · FEATURED' : ''}</td>
                <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => edit(row)}>Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type BrandRow = {
  id: string;
  slug: string;
  name: string;
  logoKey: string | null;
  isActive: boolean;
  productCount: number;
};

export function BrandEditor({ rows }: { rows: BrandRow[] }) {
  const router = useRouter();
  const empty = { name: '', slug: '', logoKey: '', isActive: true };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(row: BrandRow) {
    setEditingId(row.id);
    setForm({ name: row.name, slug: row.slug, logoKey: row.logoKey ?? '', isActive: row.isActive });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/config/brand' + (editingId ? '/' + editingId : ''), {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim().toLowerCase(),
          logoKey: form.logoKey.trim() || null,
          isActive: form.isActive,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Brand save failed.');
      setEditingId(null);
      setForm(empty);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Brand save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <form onSubmit={save} className="space-y-3 rounded-xl border p-4">
        <p className="font-semibold">{editingId ? 'Edit brand' : 'Create brand'}</p>
        <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" />
        <Input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="slug" />
        <Input value={form.logoKey} onChange={(e) => setForm({ ...form, logoKey: e.target.value })} placeholder="Logo asset key (optional)" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Active</label>
        {error ? <p className="text-danger text-sm">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          {editingId ? <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingId(null); setForm(empty); }}>Cancel</Button> : null}
        </div>
      </form>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs"><tr><th className="px-4 py-3">Brand</th><th className="px-4 py-3">Products</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr></thead>
          <tbody className="divide-y">{rows.map((row) => <tr key={row.id}><td className="px-4 py-3"><p className="font-medium">{row.name}</p><p className="text-muted-foreground text-xs">/{row.slug}</p></td><td className="px-4 py-3">{row.productCount}</td><td className="px-4 py-3">{row.isActive ? 'ACTIVE' : 'INACTIVE'}</td><td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => edit(row)}>Edit</Button></td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

type ZoneRow = {
  id: string;
  name: string;
  code: string;
  city: string;
  state: string;
  isActive: boolean;
  radiusKm: number | null;
  baseDeliveryFeePaise: number;
  freeDeliveryThresholdPaise: number | null;
  minOrderPaise: number;
  perKmFeePaise: number | null;
  maxDeliveryFeePaise: number | null;
  avgDeliveryMinutes: number | null;
  pincodes: string[];
};

export function ZoneEditor({ rows }: { rows: ZoneRow[] }) {
  const router = useRouter();
  const empty = {
    name: '', code: '', city: '', state: '', isActive: true, radiusKm: '',
    baseFee: '0', freeAbove: '', minOrder: '0', perKm: '', maxFee: '',
    avgMinutes: '', pincodes: '',
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function rupees(value: number | null) {
    return value === null ? '' : String(value / 100);
  }
  function edit(row: ZoneRow) {
    setEditingId(row.id);
    setForm({
      name: row.name, code: row.code, city: row.city, state: row.state, isActive: row.isActive,
      radiusKm: row.radiusKm === null ? '' : String(row.radiusKm),
      baseFee: rupees(row.baseDeliveryFeePaise),
      freeAbove: rupees(row.freeDeliveryThresholdPaise),
      minOrder: rupees(row.minOrderPaise),
      perKm: rupees(row.perKmFeePaise),
      maxFee: rupees(row.maxDeliveryFeePaise),
      avgMinutes: row.avgDeliveryMinutes === null ? '' : String(row.avgDeliveryMinutes),
      pincodes: row.pincodes.join(', '),
    });
  }
  const paise = (value: string) => Math.round(Number(value || '0') * 100);
  const optionalPaise = (value: string) => value.trim() ? paise(value) : null;
  const optionalInt = (value: string) => value.trim() ? Number(value) : null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/config/zone' + (editingId ? '/' + editingId : ''), {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          city: form.city.trim(),
          state: form.state.trim(),
          isActive: form.isActive,
          radiusKm: optionalInt(form.radiusKm),
          baseDeliveryFeePaise: paise(form.baseFee),
          freeDeliveryThresholdPaise: optionalPaise(form.freeAbove),
          minOrderPaise: paise(form.minOrder),
          perKmFeePaise: optionalPaise(form.perKm),
          maxDeliveryFeePaise: optionalPaise(form.maxFee),
          avgDeliveryMinutes: optionalInt(form.avgMinutes),
          pincodes: form.pincodes.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Zone save failed.');
      setEditingId(null);
      setForm(empty);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Zone save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center justify-between"><p className="font-semibold">{editingId ? 'Edit delivery zone' : 'Create delivery zone'}</p>{editingId ? <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingId(null); setForm(empty); }}>Cancel edit</Button> : null}</div>
        <div className="grid gap-3 md:grid-cols-4">
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Zone name" />
          <Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="CODE" />
          <Input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" />
          <Input required value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="State" />
          <Input type="number" min="1" value={form.radiusKm} onChange={(e) => setForm({ ...form, radiusKm: e.target.value })} placeholder="Radius km" />
          <Input type="number" min="0" step="0.01" value={form.baseFee} onChange={(e) => setForm({ ...form, baseFee: e.target.value })} placeholder="Base fee ₹" />
          <Input type="number" min="0" step="0.01" value={form.freeAbove} onChange={(e) => setForm({ ...form, freeAbove: e.target.value })} placeholder="Free above ₹" />
          <Input type="number" min="0" step="0.01" value={form.minOrder} onChange={(e) => setForm({ ...form, minOrder: e.target.value })} placeholder="Minimum order ₹" />
          <Input type="number" min="0" step="0.01" value={form.perKm} onChange={(e) => setForm({ ...form, perKm: e.target.value })} placeholder="Per km ₹" />
          <Input type="number" min="0" step="0.01" value={form.maxFee} onChange={(e) => setForm({ ...form, maxFee: e.target.value })} placeholder="Max fee ₹" />
          <Input type="number" min="1" value={form.avgMinutes} onChange={(e) => setForm({ ...form, avgMinutes: e.target.value })} placeholder="Average delivery min" />
        </div>
        <textarea className="border-input bg-background min-h-20 w-full rounded-md border p-3 text-sm" value={form.pincodes} onChange={(e) => setForm({ ...form, pincodes: e.target.value })} placeholder="Serviceable pincodes, comma or space separated" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Active</label>
        {error ? <p className="text-danger text-sm">{error}</p> : null}
        <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save zone'}</Button>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs"><tr><th className="px-4 py-3">Zone</th><th className="px-4 py-3">Pincodes</th><th className="px-4 py-3">Base fee</th><th className="px-4 py-3">Min order</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr></thead>
          <tbody className="divide-y">{rows.map((row) => <tr key={row.id}><td className="px-4 py-3"><p className="font-medium">{row.name}</p><p className="text-muted-foreground text-xs">{row.code} · {row.city}, {row.state}</p></td><td className="px-4 py-3">{row.pincodes.length}</td><td className="px-4 py-3">₹{(row.baseDeliveryFeePaise / 100).toFixed(2)}</td><td className="px-4 py-3">₹{(row.minOrderPaise / 100).toFixed(2)}</td><td className="px-4 py-3">{row.isActive ? 'ACTIVE' : 'INACTIVE'}</td><td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => edit(row)}>Edit</Button></td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
