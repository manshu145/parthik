import Link from 'next/link';
import { CreateSupportTicketForm } from '@/components/support/create-ticket-form';
import { PageShell } from '@/components/layout/page-shell';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { listSupportTicketsForUser } from '@/modules/support';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const actor = await requireCurrentActor();
  const items = await listSupportTicketsForUser(actor.userId);

  return (
    <PageShell title="Support">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <CreateSupportTicketForm />

        <div className="space-y-3">
          <h2 className="font-semibold">Your tickets</h2>
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">No support tickets yet.</p>
          ) : (
            items.map((item) => (
              <Link
                key={item.id}
                href={`/${locale}/account/support/${item.id}`}
                className="hover:bg-muted/30 block rounded-xl border p-4 transition-colors"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.subject}</p>
                    <p className="text-muted-foreground mt-1 text-xs">{item.ticketNumber}</p>
                  </div>
                  <span className="text-xs font-medium">{item.status.replaceAll('_', ' ')}</span>
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  {item.category} · {item.priority} · {item.updatedAt.toLocaleString()}
                </p>
              </Link>
            ))
          )}
        </div>
      </div>
    </PageShell>
  );
}
