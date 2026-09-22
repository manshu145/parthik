import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminSupportTickets } from '@/modules/admin-support';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('support'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('ticket:list');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [tickets, t, format] = await Promise.all([
    listAdminSupportTickets(),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-support">
      <div>
        <h1 className="text-xl font-semibold">{t('support')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Customer, vendor और driver support queue.'
            : 'Customer, vendor and driver support queue.'}
        </p>
      </div>

      {tickets.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'अभी कोई support ticket नहीं है।' : 'No support tickets yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Ticket</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">SLA</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/support/${ticket.id}`}
                        className="font-medium hover:underline"
                      >
                        {ticket.subject}
                      </Link>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {ticket.ticketNumber}
                        {ticket.orderId ? ` · order ${ticket.orderId.slice(0, 8)}…` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">{ticket.category.replaceAll('_', ' ')}</td>
                    <td className="px-4 py-3">
                      <Badge variant={ticketStatusVariant(ticket.status)}>
                        {ticket.status.replaceAll('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={priorityVariant(ticket.priority)}>{ticket.priority}</Badge>
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {ticket.slaDueAt
                        ? format.dateTime(ticket.slaDueAt, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {format.dateTime(ticket.createdAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ticketStatusVariant(status: string): BadgeVariant {
  if (status === 'RESOLVED' || status === 'CLOSED') return 'success';
  if (status === 'WAITING_ON_CUSTOMER') return 'warning';
  return 'primary';
}

function priorityVariant(priority: string): BadgeVariant {
  if (priority === 'URGENT' || priority === 'HIGH') return 'danger';
  if (priority === 'MEDIUM') return 'warning';
  return 'neutral';
}
