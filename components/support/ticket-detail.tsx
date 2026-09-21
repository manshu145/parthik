import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SupportTicketThread } from '@/components/support/ticket-thread';

type Ticket = {
  id: string;
  ticketNumber: string;
  orderId: string | null;
  category: string;
  subject: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'RESOLVED' | 'CLOSED';
  priority: string;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

type Message = {
  id: string;
  authorRole: string | null;
  message: string;
  createdAt: string;
};

export function SupportTicketDetail({
  ticket,
  messages,
  backHref,
}: {
  ticket: Ticket;
  messages: Message[];
  backHref: string;
}) {
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
          <Field label="Created" value={new Date(ticket.createdAt).toLocaleString()} />
          <Field label="Updated" value={new Date(ticket.updatedAt).toLocaleString()} />
          {ticket.resolutionNote ? (
            <div className="sm:col-span-2">
              <p className="text-muted-foreground text-xs">Resolution</p>
              <p className="mt-1 whitespace-pre-wrap">{ticket.resolutionNote}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <SupportTicketThread ticketId={ticket.id} status={ticket.status} messages={messages} />
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
