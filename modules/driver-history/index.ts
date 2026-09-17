import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { ConfigurationError } from '@/lib/errors';
import { DriverHistoryRepository } from './driver-history.repository';

export async function getDriverHistoryRepository(): Promise<DriverHistoryRepository> {
  if (!isDatabaseConfigured()) {
    throw new ConfigurationError(
      'Driver history requires a database. Set DATABASE_URL locally, or bind HYPERDRIVE on Workers.'
    );
  }

  return new DriverHistoryRepository(await getDb());
}

export { DriverHistoryRepository } from './driver-history.repository';
export type { DriverHistoryItem, DriverHistoryPage } from './driver-history.repository';
