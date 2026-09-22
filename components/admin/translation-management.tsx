'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type TranslationRow = {
  entity: 'category' | 'brand' | 'product';
  id: string;
  slug: string;
  englishName: string;
  englishDescription: string | null;
  englishShortDescription: string | null;
  englishUnitLabel: string | null;
  hindiName: string | null;
  hindiDescription: string | null;
  hindiShortDescription: string | null;
  hindiUnitLabel: string | null;
};

export function TranslationManagement({ rows }: { rows: TranslationRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'missing' | 'category' | 'brand' | 'product'>(
    'missing'
  );
  const [editing, setEditing] = useState<TranslationRow | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    shortDescription: '',
    unitLabel: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = rows.filter((row) => !row.hindiName?.trim()).length;
  const visible = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'missing') return rows.filter((row) => !row.hindiName?.trim());
    return rows.filter((row) => row.entity === filter);
  }, [rows, filter]);

  function edit(row: TranslationRow) {
    setEditing(row);
    setForm({
      name: row.hindiName ?? '',
      description: row.hindiDescription ?? '',
      shortDescription: row.hindiShortDescription ?? '',
      unitLabel: row.hindiUnitLabel ?? '',
    });
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        '/api/v1/admin/translations/' + editing.entity + '/' + editing.id,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || null,
            shortDescription:
              editing.entity === 'product' ? form.shortDescription.trim() || null : null,
            unitLabel: editing.entity === 'product' ? form.unitLabel.trim() || null : null,
          }),
        }
      );

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? 'Could not save translation.');
      }

      setEditing(null);
      setForm({ name: '', description: '', shortDescription: '', unitLabel: '' });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save translation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Tracked records" value={rows.length} />
        <Metric label="Hindi complete" value={rows.length - missing} />
        <Metric label="Hindi missing" value={missing} />
      </div>

      <div className="flex flex-wrap gap-2">
        {(['missing', 'all', 'category', 'brand', 'product'] as const).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={filter === value ? 'default' : 'secondary'}
            onClick={() => setFilter(value)}
          >
            {value.toUpperCase()}
          </Button>
        ))}
      </div>

      {editing ? (
        <form onSubmit={save} className="space-y-3 rounded-xl border p-4">
          <div>
            <p className="font-semibold">
              Hindi · {editing.entity} · /{editing.slug}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              English source: {editing.englishName}
            </p>
          </div>
          <Input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Hindi name"
            disabled={busy}
          />
          {editing.entity !== 'brand' ? (
            <textarea
              className="border-input bg-background min-h-28 w-full rounded-md border p-3 text-sm"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Hindi description"
              disabled={busy}
            />
          ) : null}
          {editing.entity === 'product' ? (
            <>
              <textarea
                className="border-input bg-background min-h-20 w-full rounded-md border p-3 text-sm"
                value={form.shortDescription}
                onChange={(event) => setForm({ ...form, shortDescription: event.target.value })}
                placeholder="Hindi short description"
                disabled={busy}
              />
              <Input
                value={form.unitLabel}
                onChange={(event) => setForm({ ...form, unitLabel: event.target.value })}
                placeholder="Hindi unit label"
                disabled={busy}
              />
            </>
          ) : null}
          {error ? <p className="text-danger text-sm">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Saving…' : 'Save Hindi translation'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setEditing(null)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">English</th>
              <th className="px-4 py-3">Hindi</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map((row) => (
              <tr key={row.entity + ':' + row.id}>
                <td className="px-4 py-3 uppercase">{row.entity}</td>
                <td className="px-4 py-3">/{row.slug}</td>
                <td className="px-4 py-3">
                  <p className="max-w-72 truncate font-medium">{row.englishName || '—'}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="max-w-72 truncate">{row.hindiName ?? '—'}</p>
                </td>
                <td className="px-4 py-3">
                  {row.hindiName?.trim() ? (
                    <span className="text-success">COMPLETE</span>
                  ) : (
                    <span className="text-warning">MISSING</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="secondary" onClick={() => edit(row)}>
                    {row.hindiName?.trim() ? 'Edit' : 'Add Hindi'}
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs">{label}</p>
    </div>
  );
}
