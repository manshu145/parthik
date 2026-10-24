import { getServerEnv } from '@/lib/config/env';
import { logger } from '@/lib/logger';
import { mapsProvider as googleMapsProvider } from './google-provider';
import { mockMapsProvider } from './mock-provider';
import type { MapsProvider } from './types';

/**
 * Maps provider selection (.kiro/steering/provider-credentials.md).
 *
 * `MAPS_PROVIDER` accepts:
 *
 *   auto   (default) — Google when a server key is present, otherwise mock
 *   google           — always Google; raises ConfigurationError without a key
 *   mock             — always the deterministic mock
 *
 * The rule that matters: **`auto` never resolves to the mock in production.** A
 * mock quietly serving real customers wrong delivery estimates would be far worse
 * than a loud 503, so production without a key fails at the point of use with a
 * typed error rather than returning plausible fiction.
 */

export type MapsProviderName = 'google' | 'mock';

export interface ResolvedMapsProvider {
  provider: MapsProvider;
  name: MapsProviderName;
  /** True when the mock is standing in because credentials are absent. */
  isFallback: boolean;
}

let warned = false;

export function resolveMapsProvider(): ResolvedMapsProvider {
  const env = getServerEnv();
  const requested = env.MAPS_PROVIDER;
  const isProduction = env.APP_ENV === 'production';
  const hasKey = Boolean(env.GOOGLE_MAPS_SERVER_KEY);

  if (requested === 'mock') {
    if (isProduction) {
      // Explicitly configured, so it is not an accident — but it is still wrong,
      // and it must be visible in logs rather than silently accepted.
      logger.error(
        'MAPS_PROVIDER=mock is set in production. Real customers will receive mock data.'
      );
    }
    return { provider: mockMapsProvider, name: 'mock', isFallback: false };
  }

  if (requested === 'google') {
    // Google adapter throws ConfigurationError on use when the key is missing;
    // that is the correct failure, so it is not pre-empted here.
    return { provider: googleMapsProvider, name: 'google', isFallback: false };
  }

  // ---- auto ----
  if (hasKey) {
    return { provider: googleMapsProvider, name: 'google', isFallback: false };
  }

  if (isProduction) {
    // No key in production: use the real adapter so the failure is a typed 503
    // rather than fabricated distances and delivery fees.
    logger.error(
      'GOOGLE_MAPS_SERVER_KEY is missing in production. Location features will fail with a configuration error rather than fall back to mock data.'
    );
    return { provider: googleMapsProvider, name: 'google', isFallback: false };
  }

  if (!warned) {
    warned = true;
    logger.info('Using the mock maps provider — no GOOGLE_MAPS_SERVER_KEY configured', {
      appEnv: env.APP_ENV,
    });
  }

  return { provider: mockMapsProvider, name: 'mock', isFallback: true };
}

/** Convenience accessor for call sites that do not care which provider is active. */
export function getMapsProvider(): MapsProvider {
  return resolveMapsProvider().provider;
}

/** Test-only: clears the one-time log guard. */
export function resetProviderWarningForTests(): void {
  warned = false;
}
