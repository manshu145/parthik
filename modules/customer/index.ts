import { getServerEnv } from '@/lib/config/env';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { getLocationService } from '@/modules/location';
import { DrizzleCustomerRepository } from './customer.repository';
import { InMemoryCustomerRepository } from './customer-memory.repository';
import type { AddressRepository } from './customer.repository.types';
import { CustomerService } from './customer.service';

/**
 * Customer module composition root.
 */

export type CustomerBackend = 'postgres' | 'memory';

let warnedAboutMemory = false;

/**
 * In PRODUCTION the in-memory repository is never used. An address held in process
 * memory would vanish on deploy and differ between isolates, so a customer would watch
 * saved addresses appear and disappear — and an order would be placed against an address
 * nothing can trace afterwards.
 */
export function resolveCustomerBackend(): CustomerBackend {
  const env = getServerEnv();

  if (isDatabaseConfigured()) return 'postgres';
  if (env.APP_ENV === 'production') return 'postgres';

  if (!warnedAboutMemory) {
    warnedAboutMemory = true;
    logger.info('Using the in-memory customer repository — no database configured', {
      appEnv: env.APP_ENV,
    });
  }

  return 'memory';
}

async function createRepository(): Promise<AddressRepository> {
  if (resolveCustomerBackend() === 'memory') return new InMemoryCustomerRepository();

  const db = await getDb();
  return new DrizzleCustomerRepository({ db });
}

export async function getCustomerService(): Promise<CustomerService> {
  const [repository, location] = await Promise.all([createRepository(), getLocationService()]);
  return new CustomerService({ repository, location });
}

/** Test-only: clears the one-time log guard. */
export function resetCustomerBackendWarningForTests(): void {
  warnedAboutMemory = false;
}

export { CustomerService, createCustomerService, MAX_ADDRESSES_PER_USER } from './customer.service';
export type { AddressWithServiceability, CustomerServiceDeps } from './customer.service';
export {
  InMemoryCustomerRepository,
  resetInMemoryAddressesForTests,
} from './customer-memory.repository';
export { DrizzleCustomerRepository, createCustomerRepository } from './customer.repository';
export {
  addressBodySchema,
  addressIdParamSchema,
  pincodeSchema,
  recipientPhoneSchema,
} from './customer.schema';
export type { AddressBody } from './customer.schema';
export type {
  AddressInput,
  AddressRecord,
  AddressRepository,
  AddressType,
} from './customer.repository.types';
