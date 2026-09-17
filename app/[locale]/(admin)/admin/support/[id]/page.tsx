import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { readAdminSupportTicket } from '@/modules/admin-support';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('ticketDetail'), robots: { index: false, follow: false } };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('ticket:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [{ ticket, messages }, t, format] = await Promise.all([
    readAdminSupportTicket(id),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4" data-testid="admin-support-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{ticket.subject}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {ticket.ticketNumber} · {t('ticketDetail')}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant={statusVariant(ticket.status)}>{ticket.status.replaceAll('_', ' ')}</Badge>
          <Badge variant={priorityVariant(ticket.priority)}>{ticket.priority}</Badge>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            <Row label="Category" value={ticket.category.replaceAll('_', ' ')} />
            <Row label="User" value={ticket.userId} />
            <Row label="Order" value={ticket.orderId ?? '—'} />
            <Row label="Assignee" value={ticket.assignedToUserId ?? '—'} />
            <Row
              label="Created"
              value={format.dateTime(ticket.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
            />
            <Row
              label="SLA"
              value={
                ticket.slaDueAt
                  ? format.dateTime(ticket.slaDueAt, { dateStyle: 'medium', timeStyle: 'short' })
                  : '—'
              }
            />
          </dl>
          {ticket.resolutionNote && (
            <p className="text-muted-foreground mt-4 border-t pt-3">{ticket.resolutionNote}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold">{locale === 'hi' ? 'बातचीत' : 'Conversation'}</h2>
          {messages.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">
              {locale === 'hi' ? 'अभी कोई message नहीं है।' : 'No messages yet.'}
            </p>
          ) : (
            <ol className="mt-3 flex flex-col gap-3">
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={
                    message.isInternalNote
                      ? 'rounded-lg border border-dashed p-3'
                      : 'rounded-lg border p-3'
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {message.authorRole ?? 'USER'}
                      {message.isInternalNote ? ' · INTERNAL NOTE' : ''}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {format.dateTime(message.createdAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                  <p className="mt-2 text-sm whitespace-pre-wrap">{message.message}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 font-medium break-all">{value}</dd>
    </div>
  );
}

function statusVariant(status: string): BadgeVariant {
  if (status === 'RESOLVED' || status === 'CLOSED') return 'success';
  if (status === 'WAITING_ON_CUSTOMER') return 'warning';
  return 'primary';
}

function priorityVariant(priority: string): BadgeVariant {
  if (priority === 'URGENT' || priority === 'HIGH') return 'danger';
  if (priority === 'MEDIUM') return 'warning';
  return 'neutral';
}
