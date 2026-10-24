import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { ConfigurationError } from '@/lib/errors';
import { DrizzleCashRepository } from './cash.repository';
import { CashService } from './cash.service';

/**
 * Cash module composition root.
 *
 * NO IN-MEMORY BACKEND, for the same reason orders and payments have none — and here the point is
 * sharper still. This ledger is the record of physical money in a person's pocket. A version of it
 * that resets on restart would erase a driver's liability, and there would be no way to tell that
 * from cash that was never collected.
 */
export async function getCashService(): Promise<CashService> {
  if (!isDatabaseConfigured()) {
    throw new ConfigurationError(
      'The cash ledger requires a database. Set DATABASE_URL — there is deliberately no in-memory backend, because a ledger that forgets is worse than no ledger at all.'
    );
  }

  const db = await getDb();
  return new CashService({ repository: new DrizzleCashRepository({ db }) });
}

export { CashService, createCashService } from './cash.service';
export type { CashPositionView, CashServiceDeps } from './cash.service';
export { DrizzleCashRepository, createCashRepository } from './cash.repository';
export {
  cashAdjustmentBodySchema,
  declareDepositBodySchema,
  depositIdParamSchema,
  rejectDepositBodySchema,
  verifyDepositBodySchema,
} from './cash.schema';
