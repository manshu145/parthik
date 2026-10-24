'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type PromotionType =
  | 'BUY_X_GET_Y'
  | 'CATEGORY_DISCOUNT'
  | 'VENDOR_CAMPAIGN'
  | 'FLASH_SALE'
  | 'FREE_DELIVERY'
  | 'NEW_CUSTOMER';

type PromotionRow = {
  id: string;
  name: string;
  promotionType: PromotionType;
  description: string | null;
  bannerId: string | null;
  priority: number;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  zoneScope: string | null;
  rules: Array<{ ruleKey: string; ruleValue: unknown }>;
};

type PromotionForm = {
  name: string;
  promotionType: PromotionType;
  description: string;
  bannerId: string;
  priority: string;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
  zoneScope: string;
  rulesJson: string;
};

const EMPTY: PromotionForm = {
  name: '',
  promotionType: 'FREE_DELIVERY',
  description: '',
  bannerId: '',
  priority: '0',
  validFrom: '',
  validUntil: '',
  isActive: false,
  zoneScope: '',
  rulesJson: '[]',
};

export function PromotionManagement({ rows }: { rows: PromotionRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PromotionForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(row: PromotionRow) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      promotionType: row.promotionType,
      description: row.description ?? '',
      bannerId: row.bannerId ?? '',
      priority: String(row.priority),
      validFrom: toDateTimeInput(row.validFrom),
      validUntil: toDateTimeInput(row.validUntil),
      isActive: row.isActive,
      zoneScope: row.zoneScope ?? '',
      rulesJson: JSON.stringify(row.rules ?? [], null, 2),
    });
    setError(null);
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const rules = JSON.parse(form.rulesJson);
      if (!Array.isArray(rules)) throw new Error('Rules must be a JSON array.');

      if (form.isActive && form.promotionType !== 'FREE_DELIVERY') {
        throw new Error(
          'Only FREE_DELIVERY promotions can be active right now. Other types are draft-only.'
        );
      }

      const response = await fetch(
        '/api/v1/admin/marketing/promotions' + (editingId ? '/' + editingId : ''),
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            promotionType: form.promotionType,
            description: nullable(form.description),
            bannerId: nullable(form.bannerId),
            priority: Number(form.priority) || 0,
            validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : null,
            validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
            isActive: form.isActive,
            zoneScope: nullable(form.zoneScope),
            rules,
          }),
        }
      );

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? 'Could not save promotion.');
      }

      reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save promotion.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="space-y-4 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{editingId ? 'Edit promotion' : 'Create promotion'}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              FREE_DELIVERY is wired into live cart, checkout and order pricing. Other promotion
              types may be prepared as drafts but cannot be activated until their pricing semantics
              are approved.
            </p>
          </div>

          {editingId ? (
            <Button type="button" size="sm" variant="secondary" onClick={reset} disabled={busy}>
              Cancel edit
            </Button>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Promotion name"
            disabled={busy}
          />

          <select
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={form.promotionType}
            onChange={(event) =>
              setForm({
                ...form,
                promotionType: event.target.value as PromotionType,
                isActive: event.target.value === 'FREE_DELIVERY' ? form.isActive : false,
              })
            }
            disabled={busy}
          >
            <option value="FREE_DELIVERY">FREE_DELIVERY</option>
            <option value="NEW_CUSTOMER">NEW_CUSTOMER</option>
            <option value="CATEGORY_DISCOUNT">CATEGORY_DISCOUNT</option>
            <option value="VENDOR_CAMPAIGN">VENDOR_CAMPAIGN</option>
            <option value="FLASH_SALE">FLASH_SALE</option>
            <option value="BUY_X_GET_Y">BUY_X_GET_Y</option>
          </select>

          <Input
            type="number"
            step="1"
            value={form.priority}
            onChange={(event) => setForm({ ...form, priority: event.target.value })}
            placeholder="Priority"
            disabled={busy}
          />

          <Input
            value={form.zoneScope}
            onChange={(event) => setForm({ ...form, zoneScope: event.target.value })}
            placeholder="Zone UUID (blank = global)"
            disabled={busy}
          />

          <Input
            value={form.bannerId}
            onChange={(event) => setForm({ ...form, bannerId: event.target.value })}
            placeholder="Banner UUID (optional)"
            disabled={busy}
          />

          <label className="space-y-1 text-xs">
            <span>Valid from</span>
            <Input
              type="datetime-local"
              value={form.validFrom}
              onChange={(event) => setForm({ ...form, validFrom: event.target.value })}
              disabled={busy}
            />
          </label>

          <label className="space-y-1 text-xs">
            <span>Valid until</span>
            <Input
              type="datetime-local"
              value={form.validUntil}
              onChange={(event) => setForm({ ...form, validUntil: event.target.value })}
              disabled={busy}
            />
          </label>

          <label className="flex items-center gap-2 rounded-md border px-3 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              disabled={busy || form.promotionType !== 'FREE_DELIVERY'}
            />
            Active
          </label>
        </div>

        <textarea
          className="border-input bg-background min-h-20 w-full rounded-md border p-3 text-sm"
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          placeholder="Description"
          disabled={busy}
        />

        <label className="block space-y-1">
          <span className="text-sm font-medium">Rules JSON</span>
          <textarea
            className="border-input bg-background min-h-36 w-full rounded-md border p-3 font-mono text-xs"
            value={form.rulesJson}
            onChange={(event) => setForm({ ...form, rulesJson: event.target.value })}
            placeholder='[{"ruleKey":"example","ruleValue":true}]'
            disabled={busy}
            spellCheck={false}
          />
          <span className="text-muted-foreground block text-xs">
            Stored for future rule types. FREE_DELIVERY runtime currently requires no extra rule.
          </span>
        </label>

        {error ? (
          <p className="text-danger text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save promotion'}
        </Button>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1050px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-3">Promotion</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Validity</th>
              <th className="px-4 py-3">Rules</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{row.name}</p>
                  <p className="text-muted-foreground mt-1 max-w-64 truncate text-xs">
                    {row.description ?? '—'}
                  </p>
                </td>
                <td className="px-4 py-3">{row.promotionType}</td>
                <td className="px-4 py-3">
                  <span className="block max-w-44 truncate">{row.zoneScope ?? 'GLOBAL'}</span>
                </td>
                <td className="px-4 py-3">{row.priority}</td>
                <td className="px-4 py-3 text-xs">
                  <p>{row.validFrom ? new Date(row.validFrom).toLocaleString() : 'Now'}</p>
                  <p>{row.validUntil ? new Date(row.validUntil).toLocaleString() : 'No expiry'}</p>
                </td>
                <td className="px-4 py-3">{row.rules.length}</td>
                <td className="px-4 py-3">
                  {row.isActive ? 'ACTIVE' : 'INACTIVE'}
                  {row.promotionType !== 'FREE_DELIVERY' ? ' · DRAFT-ONLY TYPE' : ''}
                </td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="secondary" onClick={() => edit(row)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function nullable(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

function toDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
}
