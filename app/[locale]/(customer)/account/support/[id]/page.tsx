import type { Metadata } from 'next';
import { SupportTicketDetail } from '@/components/support/ticket-detail';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { readSupportTicketForUser } from '@/modules/support';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Support ticket',
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const actor = await requireCurrentActor();
  const { ticket, messages } = await readSupportTicketForUser(actor.userId, id);

  return (
    <SupportTicketDetail
      backHref={'/' + locale + '/account/support'}
      ticket={{
        ...ticket,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
      }}
      messages={messages.map((message) => ({
        id: message.id,
        authorRole: message.authorRole,
        message: message.message,
        createdAt: message.createdAt.toISOString(),
      }))}
    />
  );
}
