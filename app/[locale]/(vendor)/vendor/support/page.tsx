import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-testid="vendor-support">
      <div>
        <h1 className="text-xl font-semibold">{t('support')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'अपने सपोर्ट अनुरोध और उनकी वर्तमान स्थिति देखें।'
            : 'Track your support requests and their current status.'}
        </p>
      </div>

      {tickets.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            <p className="font-medium">
              {locale === 'hi' ? 'अभी कोई सपोर्ट टिकट नहीं है।' : 'No support tickets yet.'}
            </p>
            <p className="text-muted-foreground mt-1">
              {locale === 'hi'
                ? 'नया टिकट बनाने का write-flow अलग से जोड़ा जाएगा।'
                : 'Ticket creation will be added as a separate write flow.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <Card>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{ticket.subject}</p>
                      <p className="text-muted-foreground mt-1 text-xs">{ticket.ticketNumber}</p>
                    </div>
                    <Badge variant={STATUS_VARIANT[ticket.status] ?? 'neutral'}>
                      {ticket.status.replaceAll('_', ' ')}
                    </Badge>
                  </div>

                  <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>{ticket.category}</span>
                    <span>{ticket.priority}</span>
                    <span>
                      {format.dateTime(ticket.createdAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>

                  {ticket.resolvedAt && (
                    <p className="text-muted-foreground text-xs">
                      {locale === 'hi' ? 'समाधान' : 'Resolved'}:{' '}
                      {format.dateTime(ticket.resolvedAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
