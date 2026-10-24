'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type NotificationRow = {
  id: string;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  eventKey: string;
  channel: string;
  title: string | null;
  body: string;
  status: string;
  providerMessageId: string | null;
  failureReason: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
};

export function NotificationManagement({ rows }: { rows: NotificationRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    userId: '',
    channel: 'IN_APP',
    category: 'ACCOUNT',
    eventKey: 'admin.message',
    title: '',
    body: '',
    data: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const data = parseData(form.data);
      const response = await fetch('/api/v1/admin/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: form.userId.trim(),
          channel: form.channel,
          category: form.category,
          eventKey: form.eventKey.trim(),
          title: form.title.trim(),
          body: form.body.trim(),
          data,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Notification send failed.');

      setMessage(
        form.channel === 'PUSH'
          ? 'Push processed: ' +
              String(payload?.data?.successCount ?? 0) +
              '/' +
              String(payload?.data?.deviceCount ?? 0) +
              ' devices.'
          : 'In-app notification sent.'
      );
      setForm((current) => ({ ...current, title: '', body: '', data: '' }));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Notification send failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={send} className="space-y-4 rounded-xl border p-4">
        <div>
          <p className="font-semibold">Send notification</p>
          <p className="text-muted-foreground mt-1 text-xs">
            PUSH uses FCM and requires an active device token. IN_APP writes directly to the
            recipient notification centre. Promotional opt-outs are enforced server-side.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Input
            required
            value={form.userId}
            onChange={(event) => setForm({ ...form, userId: event.target.value })}
            placeholder="Recipient user UUID"
            disabled={busy}
          />
          <select
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={form.channel}
            onChange={(event) => setForm({ ...form, channel: event.target.value })}
            disabled={busy}
          >
            <option value="IN_APP">IN_APP</option>
            <option value="PUSH">PUSH</option>
          </select>
          <select
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
            disabled={busy}
          >
            <option value="ACCOUNT">ACCOUNT</option>
            <option value="ORDER">ORDER</option>
            <option value="SUPPORT">SUPPORT</option>
            <option value="PROMOTION">PROMOTION</option>
          </select>
          <Input
            required
            value={form.eventKey}
            onChange={(event) => setForm({ ...form, eventKey: event.target.value })}
            placeholder="Event key"
            disabled={busy}
          />
        </div>

        <Input
          required
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="Title"
          disabled={busy}
        />
        <textarea
          className="border-input bg-background min-h-24 w-full rounded-md border p-3 text-sm"
          required
          value={form.body}
          onChange={(event) => setForm({ ...form, body: event.target.value })}
          placeholder="Message"
          disabled={busy}
        />
        <textarea
          className="border-input bg-background min-h-20 w-full rounded-md border p-3 font-mono text-xs"
          value={form.data}
          onChange={(event) => setForm({ ...form, data: event.target.value })}
          placeholder={'Optional data, one key=value per line\nlink=/orders/...'}
          disabled={busy}
        />

        {error ? (
          <p className="text-danger text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {message ? <p className="text-success text-sm">{message}</p> : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send notification'}
        </Button>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-3">Recipient</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Failure</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{row.userName ?? row.userPhone ?? row.userId}</p>
                  <p className="text-muted-foreground mt-1 max-w-52 truncate text-xs">
                    {row.userId}
                  </p>
                </td>
                <td className="px-4 py-3">{row.eventKey}</td>
                <td className="px-4 py-3">{row.channel}</td>
                <td className="px-4 py-3">{row.status}</td>
                <td className="px-4 py-3">
                  <p className="max-w-72 truncate font-medium">{row.title ?? 'Notification'}</p>
                  <p className="text-muted-foreground mt-1 max-w-72 truncate text-xs">{row.body}</p>
                </td>
                <td className="text-danger px-4 py-3 text-xs">{row.failureReason ?? '—'}</td>
                <td className="text-muted-foreground px-4 py-3 text-xs">
                  {new Date(row.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseData(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [index, raw] of value.split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error('Invalid data line ' + (index + 1) + '. Use key=value.');
    const key = line.slice(0, separator).trim();
    const dataValue = line.slice(separator + 1).trim();
    if (!key) throw new Error('Invalid data key on line ' + (index + 1) + '.');
    result[key] = dataValue;
  }
  return result;
}

type TemplateRow = {
  id: string;
  eventKey: string;
  channel: string;
  locale: string;
  subject: string | null;
  body: string;
  variables: unknown;
  isActive: boolean;
  version: number;
  updatedAt: string;
};

const EMPTY_TEMPLATE = {
  eventKey: '',
  channel: 'IN_APP',
  locale: 'en',
  subject: '',
  body: '',
  variables: '',
  isActive: true,
};

export function NotificationTemplateManagement({ rows }: { rows: TemplateRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [form, setForm] = useState(EMPTY_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function edit(row: TemplateRow) {
    setEditing(row);
    setForm({
      eventKey: row.eventKey,
      channel: row.channel,
      locale: row.locale,
      subject: row.subject ?? '',
      body: row.body,
      variables: toVariables(row.variables).join(', '),
      isActive: row.isActive,
    });
    setError(null);
    setMessage(null);
  }

  function reset() {
    setEditing(null);
    setForm(EMPTY_TEMPLATE);
    setError(null);
    setMessage(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const variables = [
        ...new Set(
          form.variables
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        ),
      ];
      const path = editing
        ? '/api/v1/admin/notification-templates/' + editing.id
        : '/api/v1/admin/notification-templates';

      const body = editing
        ? {
            subject: form.subject.trim() || null,
            body: form.body.trim(),
            variables,
            isActive: form.isActive,
          }
        : {
            eventKey: form.eventKey.trim(),
            channel: form.channel,
            locale: form.locale,
            subject: form.subject.trim() || null,
            body: form.body.trim(),
            variables,
            isActive: form.isActive,
          };

      const response = await fetch(path, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not save template.');

      setMessage(
        editing
          ? 'New template version created; previous active version was retired when applicable.'
          : 'Template created.'
      );
      setEditing(null);
      setForm(EMPTY_TEMPLATE);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save template.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <form onSubmit={save} className="space-y-3 rounded-xl border p-4">
        <div>
          <p className="font-semibold">
            {editing ? 'Create new template version' : 'Create template'}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            V1 enables only PUSH and IN_APP. Editing creates a new immutable version.
          </p>
        </div>

        <Input
          required
          value={form.eventKey}
          onChange={(event) => setForm({ ...form, eventKey: event.target.value })}
          placeholder="order.delivered"
          disabled={busy || editing !== null}
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={form.channel}
            onChange={(event) => setForm({ ...form, channel: event.target.value })}
            disabled={busy || editing !== null}
          >
            <option value="IN_APP">IN_APP</option>
            <option value="PUSH">PUSH</option>
          </select>
          <select
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={form.locale}
            onChange={(event) => setForm({ ...form, locale: event.target.value })}
            disabled={busy || editing !== null}
          >
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </div>
        <Input
          value={form.subject}
          onChange={(event) => setForm({ ...form, subject: event.target.value })}
          placeholder="Subject / push title (optional)"
          disabled={busy}
        />
        <textarea
          className="border-input bg-background min-h-36 w-full rounded-md border p-3 text-sm"
          required
          value={form.body}
          onChange={(event) => setForm({ ...form, body: event.target.value })}
          placeholder="Template body"
          disabled={busy}
        />
        <Input
          value={form.variables}
          onChange={(event) => setForm({ ...form, variables: event.target.value })}
          placeholder="Variables: orderNumber, customerName"
          disabled={busy}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            disabled={busy}
          />
          Active
        </label>

        {error ? <p className="text-danger text-sm">{error}</p> : null}
        {message ? <p className="text-success text-sm">{message}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Saving…' : 'Save template'}
          </Button>
          {editing ? (
            <Button type="button" size="sm" variant="secondary" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Locale</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Body</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-medium">{row.eventKey}</td>
                <td className="px-4 py-3">{row.channel}</td>
                <td className="px-4 py-3">{row.locale}</td>
                <td className="px-4 py-3">v{row.version}</td>
                <td className="px-4 py-3">{row.isActive ? 'ACTIVE' : 'INACTIVE'}</td>
                <td className="px-4 py-3">
                  <p className="max-w-80 truncate">{row.body}</p>
                </td>
                <td className="px-4 py-3">
                  {row.channel === 'PUSH' || row.channel === 'IN_APP' ? (
                    <Button size="sm" variant="secondary" onClick={() => edit(row)}>
                      Revise
                    </Button>
                  ) : (
                    <span className="text-muted-foreground text-xs">Reserved channel</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function toVariables(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
