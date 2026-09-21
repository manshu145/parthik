'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const CATEGORIES = [
  'PAYMENT',
  'DELIVERY',
  'PRODUCT',
  'REFUND',
  'COUPON',
  'ACCOUNT',
  'VENDOR',
  'OTHER',
] as const;

export function CreateSupportTicketForm() {
  const router = useRouter();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('OTHER');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (subject.trim().length < 3) {
      setError('Enter a subject with at least 3 characters.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          subject: subject.trim(),
          message: message.trim() || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Ticket creation failed.');
      setSubject('');
      setMessage('');
      setCategory('OTHER');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ticket creation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <h2 className="font-semibold">Create ticket</h2>
      <select
        className="bg-background h-10 w-full rounded-lg border px-3 text-sm"
        value={category}
        onChange={(event) => setCategory(event.target.value as (typeof CATEGORIES)[number])}
        disabled={busy}
      >
        {CATEGORIES.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <Input
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        required
        minLength={3}
        maxLength={200}
        placeholder="How can we help?"
        disabled={busy}
      />
      <textarea
        className="bg-background min-h-28 w-full rounded-lg border p-3 text-sm"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={5000}
        placeholder="Describe the issue (optional)"
        disabled={busy}
      />
      {error ? (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button onClick={() => void submit()} disabled={busy || subject.trim().length < 3}>
        {busy ? 'Creating…' : 'Submit ticket'}
      </Button>
    </div>
  );
}
