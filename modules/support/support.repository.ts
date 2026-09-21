import { desc, eq } from 'drizzle-orm';
import { supportTickets } from '@/db/schema';
import { getDb } from '@/lib/db/client';

export interface SupportTicketListItem {
  id: string;
  ticketNumber: string;
  category: (typeof supportTickets.$inferSelect)['category'];
  subject: string;
  status: (typeof supportTickets.$inferSelect)['status'];
  priority: (typeof supportTickets.$inferSelect)['priority'];
  slaDueAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lists only the authenticated user's support tickets.
 *
 * This read model intentionally does not join `ticket_messages`, so internal notes and attachment
 * storage keys cannot accidentally leak onto a dashboard list. A future ticket-detail service
 * must filter `is_internal_note = false` in the repository before any app route can read it.
 */
export async function listSupportTicketsForUser(
  userId: string,
  limit = 50
): Promise<SupportTicketListItem[]> {
  const db = await getDb();

  return db
    .select({
      id: supportTickets.id,
      ticketNumber: supportTickets.ticketNumber,
      category: supportTickets.category,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      slaDueAt: supportTickets.slaDueAt,
      resolvedAt: supportTickets.resolvedAt,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
    })
    .from(supportTickets)
    .where(eq(supportTickets.userId, userId))
    .orderBy(desc(supportTickets.createdAt), desc(supportTickets.id))
    .limit(Math.min(Math.max(limit, 1), 100));
}
