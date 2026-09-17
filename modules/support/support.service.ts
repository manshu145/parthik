import { listSupportTicketsForUser as readSupportTicketsForUser } from './support.repository';

/**
 * Application-facing support read service.
 *
 * Keeping this boundary now prevents dashboard routes from growing direct database access when
 * ticket creation, public-message threads and SLA actions are added later.
 */
export async function listSupportTicketsForUser(userId: string, limit = 50) {
  return readSupportTicketsForUser(userId, limit);
}
