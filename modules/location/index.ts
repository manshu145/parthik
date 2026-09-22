import { getServerEnv } from '@/lib/config/env';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { resolveMapsProvider } from '@/lib/maps/provider-factory';
import { GoogleMapsProvider } from '@/lib/maps/google-provider';
import { mockMapsProvider } from '@/lib/maps/mock-provider';
import { readProviderSetting } from '@/modules/provider-settings';
import { DrizzleLocationRepository } from './location.repository';
import {
  InMemoryLocationRepository,
  inMemoryServiceablePincodes,
} from './location-memory.repository';
import type { LocationRepository } from './location.repository.types';
import { LocationService } from './location.service';

/**
 * Location module composition root.
 *
 * Route handlers call `getLocationService()` and never construct a repository or
 * pick a provider themselves, so the credential-free fallback rules live in exactly
 * one place.
 */

export type LocationBackend = 'postgres' | 'memory';

let warnedAboutMemory = false;

/**
 * Chooses the repository implementation.
 *
 * Postgres when a connection is configured; the in-memory fixture otherwise, so a
 * fresh clone can exercise the location flow with no database.
 *
 * In PRODUCTION the in-memory fixture is never used. Serving fabricated
 * serviceability to real customers — telling someone we deliver to them when we do
 * not — is worse than a 503, so the database error is allowed to surface.
 */
export function resolveLocationBackend(): LocationBackend {
  const env = getServerEnv();

  if (isDatabaseConfigured()) return 'postgres';
  if (env.APP_ENV === 'production') return 'postgres';

  if (!warnedAboutMemory) {
    warnedAboutMemory = true;
    logger.info('Using the in-memory location repository — no database configured', {
      appEnv: env.APP_ENV,
    });
  }

  return 'memory';
}

async function createLocationRepository(): Promise<LocationRepository> {
  if (resolveLocationBackend() === 'memory') {
    return new InMemoryLocationRepository();
  }

  // Throws ConfigurationError (503) when unreachable, which is the correct
  // production failure.
  const db = await getDb();
  return new DrizzleLocationRepository({ db });
}

export async function getLocationService(): Promise<LocationService> {
  const repository = await createLocationRepository();
  const [configuredProvider, configuredKey] = await Promise.all([
    readProviderSetting('maps.provider'),
    readProviderSetting('maps.google_server_key'),
  ]);
  const provider =
    configuredProvider === 'mock'
      ? mockMapsProvider
      : configuredKey
        ? new GoogleMapsProvider(configuredKey)
        : resolveMapsProvider().provider;

  return new LocationService({ repository, maps: provider });
}

/**
 * Backend status for development diagnostics.
 *
 * Exposed through the module rather than letting a route import the repository
 * directly, so the app/ → repository import boundary stays intact.
 *
 * Pincodes are only listed for the in-memory fixture. The real zone table's
 * pincode list is operational data and is not diagnostics material.
 */
export function describeLocationBackend(): {
  backend: LocationBackend;
  databaseConfigured: boolean;
  serviceablePincodes: string[] | null;
} {
  const backend = resolveLocationBackend();

  return {
    backend,
    databaseConfigured: isDatabaseConfigured(),
    serviceablePincodes: backend === 'memory' ? inMemoryServiceablePincodes() : null,
  };
}

/** Test-only: clears the one-time log guard. */
export function resetLocationBackendWarningForTests(): void {
  warnedAboutMemory = false;
}

export { LocationService } from './location.service';
export { InMemoryLocationRepository } from './location-memory.repository';
export {
  DrizzleLocationRepository,
  createLocationRepository as createDrizzleLocationRepository,
} from './location.repository';
export { calculateDeliveryFee, estimateDeliveryWindow } from './delivery-fee';
export type { ZoneFeeConfig, DeliveryFeeInput, DeliveryFeeResult } from './delivery-fee';
export type {
  DeliveryZoneRecord,
  LocationRepository,
  ZoneSummary,
} from './location.repository.types';
export type { ServiceabilityResult, DeliveryQuote } from './location.service';
