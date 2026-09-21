import type { Metadata } from 'next';
import { SupportTicketDetail } from '@/components/support/ticket-detail';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Vendor support ticket',
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  return <SupportTicketDetail ticketId={id} backHref={`/${locale}/vendor/support`} />;
}
