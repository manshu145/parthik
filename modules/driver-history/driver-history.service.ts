import { getDriverHistoryForUser as readDriverHistoryForUser } from './driver-history.repository';

export interface DriverHistoryQuery {
  userId: string;
  limit?: number;
  cursor?: string;
}

/**
 * Application-facing driver history service.
 *
 * The repository remains the only database chokepoint; app routes call this service boundary so
 * ownership and future history business rules cannot be bypassed by importing data access code.
 */
export async function getDriverHistoryForUser(query: DriverHistoryQuery) {
  return readDriverHistoryForUser(query);
}
