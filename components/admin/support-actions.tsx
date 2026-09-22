'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'RESOLVED' | 'CLOSED';
type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export function SupportActions({
  ticketId,
  status,
  priority,
  canReply,
  canManage,
}: {
  ticketId: string;
  status: TicketStatus;
  priority: TicketPriority;
  canReply: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(false);
  const [nextStatus, setNextStatus] = useState<TicketStatus>(status);
  const [nextPriority, setNextPriority] = useState<TicketPriority>(priority);
  const [resolutionNote, setResolutionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/actions/support/' + ticketId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Support action failed.');
      setMessage('');
      setResolutionNote('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Support action failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!canReply && !canManage) return null;

  return (
    <div className="grid gap-4 rounded-xl border p-4 lg:grid-cols-2">
      {canReply ? (
        <div>
          <p className="text-sm font-semibold">Reply</p>
          <textarea
            className="border-input bg-background mt-2 min-h-28 w-full rounded-md border p-3 text-sm"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Write a reply or internal note…"
            maxLength={5000}
            disabled={busy}
          />
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={internal}
              onChange={(event) => setInternal(event.target.checked)}
              disabled={busy}
            />
            Internal note (not visible to customer)
          </label>
          <Button
            className="mt-3"
            size="sm"
            disabled={busy || !message.trim()}
            onClick={() => void request({ action: 'reply', message, internal })}
          >
            {busy ? 'Sending…' : internal ? 'Add note' : 'Send reply'}
          </Button>
        </div>
      ) : null}

      {canManage ? (
        <div>
          <p className="text-sm font-semibold">Ticket controls</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <select
              className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value as TicketStatus)}
              disabled={busy}
            >
              {['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
            <select
              className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              value={nextPriority}
              onChange={(event) => setNextPriority(event.target.value as TicketPriority)}
              disabled={busy}
            >
              {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <Input
            className="mt-2"
            value={resolutionNote}
            onChange={(event) => setResolutionNote(event.target.value)}
            placeholder="Resolution note (optional)"
            maxLength={5000}
            disabled={busy}
          />
          <Button
            className="mt-3"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void request({
                action: 'update',
                status: nextStatus,
                priority: nextPriority,
                resolutionNote: resolutionNote.trim() || undefined,
              })
            }
          >
            {busy ? 'Saving…' : 'Save ticket'}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="text-danger text-sm lg:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
