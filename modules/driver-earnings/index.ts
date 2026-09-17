import {
  readDriverEarningsForUser,
  type DriverEarningView,
  type DriverEarningsSummary,
} from './driver-earnings.repository';

/**
 * Read-only driver earnings projection.
 *
 * Ownership is derived from the authenticated user's driver row inside the repository. The caller
 * never supplies a driver id, so one driver cannot enumerate another driver's ledger by changing
 * a URL or request body. Settlement mutations remain outside this module until D-15 is approved.
 */
export async function getDriverEarningsForUser(
  userId: string,
  limit = 100
): Promise<DriverEarningsSummary> {
  return readDriverEarningsForUser(userId, limit);
}

export type { DriverEarningView, DriverEarningsSummary };
