import { and, asc, desc, eq } from 'drizzle-orm';
import { supportTickets, ticketMessages } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

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

export type SupportTicketCategory =
  'PAYMENT' | 'DELIVERY' | 'PRODUCT' | 'REFUND' | 'COUPON' | 'ACCOUNT' | 'VENDOR' | 'OTHER';

export async function createSupportTicketForUser(
  userId: string,
  input: {
    category: SupportTicketCategory;
    subject: string;
    message?: string;
    orderId?: string;
  }
) {
  const subject = input.subject.trim();
  const message = input.message?.trim();
  if (subject.length < 3) {
    throw new ValidationError('Ticket subject is too short.', {
      subject: ['Use at least 3 characters.'],
    });
  }

  const ticketNumber =
    'PTK-' +
    new Date().toISOString().slice(0, 10).replaceAll('-', '') +
    '-' +
    crypto.randomUUID().slice(0, 8).toUpperCase();
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        userId,
        ticketNumber,
        category: input.category,
        subject,
        orderId: input.orderId,
      })
      .returning({
        id: supportTickets.id,
        ticketNumber: supportTickets.ticketNumber,
        status: supportTickets.status,
      });

    if (!ticket) throw new ConflictError('Support ticket could not be created.');

    if (message) {
      await tx.insert(ticketMessages).values({
        ticketId: ticket.id,
        authorUserId: userId,
        authorRole: 'USER',
        message,
        isInternalNote: false,
      });
    }

    return ticket;
  });
}

export async function readSupportTicketForUser(userId: string, ticketId: string) {
  const db = await getDb();
  const [ticket] = await db
    .select({
      id: supportTickets.id,
      ticketNumber: supportTickets.ticketNumber,
      orderId: supportTickets.orderId,
      category: supportTickets.category,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      resolutionNote: supportTickets.resolutionNote,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
    })
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)))
    .limit(1);

  if (!ticket) throw new NotFoundError('Support ticket could not be found.');

  const messages = await db
    .select({
      id: ticketMessages.id,
      authorUserId: ticketMessages.authorUserId,
      authorRole: ticketMessages.authorRole,
      message: ticketMessages.message,
      createdAt: ticketMessages.createdAt,
    })
    .from(ticketMessages)
    .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.isInternalNote, false)))
    .orderBy(asc(ticketMessages.createdAt), asc(ticketMessages.id));

  return { ticket, messages };
}

export async function replySupportTicketForUser(userId: string, ticketId: string, message: string) {
  const text = message.trim();
  if (!text) {
    throw new ValidationError('Reply cannot be empty.', { message: ['Enter a reply.'] });
  }

  const db = await getDb();
  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .select({
        id: supportTickets.id,
        status: supportTickets.status,
      })
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)))
      .limit(1);

    if (!ticket) throw new NotFoundError('Support ticket could not be found.');
    if (ticket.status === 'CLOSED') {
      throw new ConflictError('This support ticket is closed.');
    }

    const [created] = await tx
      .insert(ticketMessages)
      .values({
        ticketId,
        authorUserId: userId,
        authorRole: 'USER',
        message: text,
        isInternalNote: false,
      })
      .returning({ id: ticketMessages.id, createdAt: ticketMessages.createdAt });

    const shouldReopen = ticket.status === 'WAITING_ON_CUSTOMER' || ticket.status === 'RESOLVED';
    if (shouldReopen) {
      await tx
        .update(supportTickets)
        .set({
          status: 'IN_PROGRESS',
          resolvedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(supportTickets.id, ticketId));
    } else {
      await tx
        .update(supportTickets)
        .set({ updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId));
    }

    return created;
  });
}
