import { asc, desc, eq } from 'drizzle-orm';
import { supportTickets, ticketMessages } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { NotFoundError } from '@/lib/errors';

export async function listAdminSupportTickets(limit = 200) {
  const db = await getDb();
  return db
    .select({
      id: supportTickets.id,
      ticketNumber: supportTickets.ticketNumber,
      orderId: supportTickets.orderId,
      category: supportTickets.category,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      assignedToUserId: supportTickets.assignedToUserId,
      slaDueAt: supportTickets.slaDueAt,
      resolvedAt: supportTickets.resolvedAt,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
    })
    .from(supportTickets)
    .orderBy(desc(supportTickets.createdAt), desc(supportTickets.id))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export async function readAdminSupportTicket(ticketId: string) {
  const db = await getDb();
  const [ticket] = await db
    .select({
      id: supportTickets.id,
      ticketNumber: supportTickets.ticketNumber,
      userId: supportTickets.userId,
      orderId: supportTickets.orderId,
      category: supportTickets.category,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      assignedToUserId: supportTickets.assignedToUserId,
      slaDueAt: supportTickets.slaDueAt,
      firstResponseAt: supportTickets.firstResponseAt,
      resolvedAt: supportTickets.resolvedAt,
      closedAt: supportTickets.closedAt,
      resolutionNote: supportTickets.resolutionNote,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
    })
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1);

  if (!ticket) throw new NotFoundError('Support ticket could not be found.');

  const messages = await db
    .select({
      id: ticketMessages.id,
      authorUserId: ticketMessages.authorUserId,
      authorRole: ticketMessages.authorRole,
      message: ticketMessages.message,
      isInternalNote: ticketMessages.isInternalNote,
      createdAt: ticketMessages.createdAt,
    })
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.createdAt), asc(ticketMessages.id));

  return { ticket, messages };
}
