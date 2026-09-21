import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SupportTicketThread } from '@/components/support/ticket-thread';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { readSupportTicketForUser } from '@/modules/support';

export async function SupportTicketDetail({
  ticketId,
  backHref,
}: {
  ticketId: string;
  backHref: string;
}) {
  const actor = await requireCurrentActor();
  const { ticket, messages } = await readSupportTicketForUser(actor.userId, ticketId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <Link href={backHref} className="text-muted-foreground text-sm hover:underline">
          ← Back to support
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{ticket.subject}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {ticket.ticketNumber} · {ticket.category}
            </p>
          </div>
          <Badge
            variant={
              ticket.status === 'RESOLVED'
                ? 'success'
                : ticket.status === 'CLOSED'
                  ? 'neutral'
                  : ticket.status === 'WAITING_ON_CUSTOMER'
                    ? 'warning'
                    : 'primary'
            }
          >
            {ticket.status.replaceAll('_', ' ')}
          </Badge>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 text-sm sm:grid-cols-2">
          <Field label="Priority" value={ticket.priority} />
          <Field label="Order" value={ticket.orderId ?? '—'} />
          <Field label="Created" value={ticket.createdAt.toLocaleString()} />
          <Field label="Updated" value={ticket.updatedAt.toLocaleString()} />
          {ticket.resolutionNote ? (
            <div className="sm:col-span-2">
              <p className="text-muted-foreground text-xs">Resolution</p>
              <p className="mt-1 whitespace-pre-wrap">{ticket.resolutionNote}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <SupportTicketThread
        ticketId={ticket.id}
        status={ticket.status}
        messages={messages.map((message) => ({
          id: message.id,
          authorRole: message.authorRole,
          message: message.message,
          createdAt: message.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}
