'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Field = { key: string; label: string; secret: boolean; configured: boolean; value: string };

export function ProviderSettingsForm({ initial }: { initial: Field[] }) {
  const [fields, setFields] = useState(initial);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/provider-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error?.message ?? 'Could not save provider settings.');
      setFields(payload.data.settings);
      setValues({});
      setMessage(
        'Provider configuration saved. Server-side Maps and Razorpay changes apply to new requests; browser/build-time settings may require a deployment.'
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save provider settings.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        {fields.map((field) => (
          <label key={field.key} className="space-y-1 rounded-xl border p-4 text-sm">
            <span className="flex items-center justify-between gap-2 font-medium">
              {field.label}
              <span className={field.configured ? 'text-success text-xs' : 'text-warning text-xs'}>
                {field.configured ? 'Configured' : 'Not configured'}
              </span>
            </span>
            <Input
              type={field.secret ? 'password' : 'text'}
              value={values[field.key] ?? field.value}
              placeholder={
                field.secret && field.configured ? '•••••••• (leave blank to keep)' : 'Enter value'
              }
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
              disabled={busy}
            />
            <span className="text-muted-foreground block text-xs">{field.key}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="text-success text-sm">{message}</p> : null}
      <Button type="submit" disabled={busy || Object.keys(values).length === 0}>
        {busy ? 'Saving…' : 'Save provider settings'}
      </Button>
    </form>
  );
}
