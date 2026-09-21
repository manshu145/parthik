import {
  createSupportTicketForUser as createTicket,
  listSupportTicketsForUser as readSupportTicketsForUser,
  readSupportTicketForUser as readTicket,
  replySupportTicketForUser as replyTicket,
  type SupportTicketCategory,
} from './support.repository';

export async function listSupportTicketsForUser(userId: string, limit = 50) {
  return readSupportTicketsForUser(userId, limit);
}

export async function createSupportTicketForUser(
  userId: string,
  input: {
    category: SupportTicketCategory;
    subject: string;
    message?: string;
    orderId?: string;
  }
) {
  return createTicket(userId, input);
}

export async function readSupportTicketForUser(userId: string, ticketId: string) {
  return readTicket(userId, ticketId);
}

export async function replySupportTicketForUser(userId: string, ticketId: string, message: string) {
  return replyTicket(userId, ticketId, message);
}
