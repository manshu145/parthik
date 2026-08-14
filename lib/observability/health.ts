import { getServerEnv } from '@/lib/config/env';
import { isDatabaseConfigured } from '@/lib/db/client';
import { isFirebaseClientConfigured, isFirebaseServerConfigured } from '@/lib/firebase/config';
import { pushSender } from '@/lib/firebase/messaging';
import { resolveMapsProvider } from '@/lib/maps/provider-factory';
import { analytics } from '@/lib/analytics';
import { cloudLoggingSink } from './cloud-logging';

/**
 * Dependency readiness for the admin System Health screen (master spec §30) and
 * for /api/v1/health/deep.
 *
 * This is the observable proof of the "fails safely without credentials"
 * requirement: an unconfigured provider reports `not_configured` and the
 * application keeps serving, rather than crashing at boot or on first use.
 */

export type ComponentState = 'ok' | 'not_configured' | 'degraded' | 'error';

export interface ComponentHealth {
  name: string;
  state: ComponentState;
  /** Whether the application can serve requests at all without this. */
  required: boolean;
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'unhealthy';
  environment: string;
  timestamp: string;
  components: ComponentHealth[];
}

/**
 * Maps readiness.
 *
 * The STATE reflects whether a real provider is configured; the active provider
 * name goes in the detail. So a mock fallback reads as `not_configured` — truthful,
 * since there is no key — while the detail makes it impossible to mistake the mock
 * for live Google.
 *
 * Deliberately NOT `degraded`: degradation means a configured dependency is
 * misbehaving. Every developer machine and preview deploy legitimately runs on
 * mocks, and permanently reporting the whole system as degraded would train
 * everyone to ignore the health check.
 */
function mapsState(): ComponentState {
  return getServerEnv().GOOGLE_MAPS_SERVER_KEY ? 'ok' : 'not_configured';
}

/**
 * Configuration-level readiness only — no network calls, so it is cheap and safe
 * to expose. Live dependency probing (a real database ping) arrives with the
 * component that owns the connection in TASK 002.
 */
export function getHealthReport(): HealthReport {
  const env = getServerEnv();

  const components: ComponentHealth[] = [
    {
      name: 'config',
      state: 'ok',
      required: true,
      detail: 'Environment validated at startup',
    },
    {
      name: 'database',
      state: isDatabaseConfigured() ? 'ok' : 'not_configured',
      // Not required yet: no schema exists until TASK 002.
      required: false,
      detail: isDatabaseConfigured()
        ? 'Connection string available'
        : 'DATABASE_URL / HYPERDRIVE binding absent (expected before TASK 002)',
    },
    {
      name: 'cache',
      state: env.CACHE_REST_URL && env.CACHE_REST_TOKEN ? 'ok' : 'not_configured',
      required: false,
      detail: 'Redis-compatible HTTP store (D-03)',
    },
    {
      name: 'firebase-auth-client',
      state: isFirebaseClientConfigured() ? 'ok' : 'not_configured',
      required: false,
      detail: 'Sign-in is unavailable while unconfigured (D-08)',
    },
    {
      name: 'firebase-auth-server',
      state: isFirebaseServerConfigured() ? 'ok' : 'not_configured',
      required: false,
      detail: 'Service account for Identity Platform REST (D-36)',
    },
    {
      name: 'fcm',
      state: pushSender.isConfigured() ? 'ok' : 'not_configured',
      required: false,
      detail: 'Push channel (D-26)',
    },
    {
      name: 'google-maps',
      // Reports the ACTIVE provider, not merely whether a key exists. A green
      // "ok" while the mock is quietly serving requests would be worse than no
      // check at all. The provider NAME is safe to expose here; key material is
      // not, and never appears.
      state: mapsState(),
      required: false,
      detail: `Places, Geocoding, Routes (D-23) — active provider: ${resolveMapsProvider().name}`,
    },
    {
      name: 'analytics',
      state: analytics.isConfigured() ? 'ok' : 'not_configured',
      required: false,
      detail: 'GA4 Measurement Protocol (D-28)',
    },
    {
      name: 'cloud-logging',
      state: cloudLoggingSink.isConfigured() ? 'ok' : 'not_configured',
      required: false,
      detail: 'Falls back to stdout when unconfigured (D-27)',
    },
    // Blocked decisions are surfaced explicitly so their absence reads as a
    // known state rather than a misconfiguration.
    {
      name: 'email',
      state: 'not_configured',
      required: false,
      detail: 'BLOCKED by D-25 — no Google-native transactional email provider',
    },
    {
      name: 'sms-transactional',
      state: 'not_configured',
      required: false,
      detail: 'BLOCKED by D-34 — Firebase covers OTP only',
    },
  ];

  const requiredFailing = components.some(
    (component) => component.required && component.state !== 'ok'
  );
  const anyDegraded = components.some(
    (component) => component.state === 'degraded' || component.state === 'error'
  );

  return {
    status: requiredFailing ? 'unhealthy' : anyDegraded ? 'degraded' : 'ok',
    environment: env.APP_ENV,
    timestamp: new Date().toISOString(),
    components,
  };
}
