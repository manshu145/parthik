import { getServerEnv } from '@/lib/config/env';
import { isDatabaseConfigured } from '@/lib/db/client';
import { isFirebaseClientConfigured, isFirebaseServerConfigured } from '@/lib/firebase/config';
import { pushSender } from '@/lib/firebase/messaging';
import { mapsProvider } from '@/lib/maps/google-provider';
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
      state: mapsProvider.isConfigured() ? 'ok' : 'not_configured',
      required: false,
      detail: 'Places, Geocoding, Routes (D-23)',
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
