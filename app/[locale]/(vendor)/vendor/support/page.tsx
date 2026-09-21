import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { CreateSupportTicketForm } from '@/components/support/create-ticket-form';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { listSupportTicketsForUser } from '@/modules/support';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  OPEN: 'primary',
  IN_PROGRESS: 'warning',
  WAITING_ON_CUSTOMER: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });
  return { title: t('support'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const actor = await requireCurrentActor();
  const [tickets, t, format] = await Promise.all([
    listSupportTicketsForUser(actor.userId),
    getTranslations('vendorNav'),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4" data-testid="vendor-support">
      <div>
        <h1 className="text-xl font-semibold">{t('support')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Create, track and reply to support requests.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <CreateSupportTicketForm />

        <div className="space-y-3">
          {tickets.length === 0 ? (
            <p className="text-muted-foreground text-sm">No support tickets yet.</p>
          ) : (
            tickets.map((ticket) => (
              <Link
                key={ticket.id}
                href={`/${locale}/vendor/support/${ticket.id}`}
                className="block rounded-xl border p-4 transition-colors hover:bg-muted/30"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{ticket.subject}</p>
                    <p className="text-muted-foreground mt-1 text-xs">{ticket.ticketNumber}</p>
                  </div>
                  <Badge variant={STATUS_VARIANT[ticket.status] ?? 'neutral'}>
                    {ticket.status.replaceAll('_', ' ')}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  {ticket.category} · {ticket.priority} ·{' '}
                  {format.dateTime(ticket.updatedAt, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
