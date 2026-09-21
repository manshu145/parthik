'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

type Message = {
  id: string;
  authorRole: string | null;
  message: string;
  createdAt: string;
};

export function SupportTicketThread({
  ticketId,
  status,
  messages,
}: {
  ticketId: string;
  status: string;
  messages: Message[];
}) {
  const router = useRouter();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/support/tickets/' + ticketId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reply.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Reply failed.');
      setReply('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Reply failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {messages.length === 0 ? (
        <p className="text-muted-foreground text-sm">No messages yet.</p>
      ) : (
        <ol className="space-y-3">
          {messages.map((message) => (
            <li key={message.id} className="rounded-xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  {message.authorRole === 'ADMIN' ? 'Support' : 'You'}
                </p>
                <time className="text-muted-foreground text-xs">
                  {new Date(message.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{message.message}</p>
            </li>
          ))}
        </ol>
      )}

      {status !== 'CLOSED' ? (
        <div className="rounded-xl border p-4">
          <textarea
            className="bg-background min-h-28 w-full rounded-lg border p-3 text-sm"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder="Write a reply…"
            maxLength={5000}
            disabled={busy}
          />
          {error ? (
            <p className="text-danger mt-2 text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <Button className="mt-3" onClick={() => void send()} disabled={busy || !reply.trim()}>
            {busy ? 'Sending…' : 'Send reply'}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">This ticket is closed.</p>
      )}
    </div>
  );
}
