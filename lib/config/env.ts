import { z } from 'zod';

/**
 * The single boundary where configuration enters the application
 * (docs/ARCHITECTURE.md §15). No other file may read process.env — an ESLint
 * rule enforces this.
 *
 * Two principles:
 *
 *  1. REQUIRED config is validated eagerly and the app refuses to start when it
 *     is wrong. Failing at boot is far cheaper than failing at runtime.
 *
 *  2. OPTIONAL provider config degrades safely. A missing Firebase or Maps key
 *     must not crash the process; the affected provider reports itself as
 *     unconfigured and throws a typed ConfigurationError only if something
 *     actually tries to use it. This is what makes local development possible
 *     without a full set of third-party credentials.
 */

const nonEmpty = z.string().trim().min(1);

/** Accepts a PEM private key whether it arrives with real or escaped newlines. */
const pemKey = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.replace(/\\n/g, '\n'))
  .refine((value) => value.includes('BEGIN') && value.includes('PRIVATE KEY'), {
    message: 'must be a PEM-encoded private key',
  });

const serverSchema = z.object({
  // ---- Core (required) ----
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'preview', 'staging', 'production']).default('development'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  // ---- Data (optional until TASK 002) ----
  DATABASE_URL: z.string().url().optional(),

  // ---- Cache (optional until TASK 003; D-03) ----
  CACHE_REST_URL: z.string().url().optional(),
  CACHE_REST_TOKEN: nonEmpty.optional(),

  // ---- Firebase server-side (D-08, D-36) ----
  FIREBASE_PROJECT_ID: nonEmpty.optional(),
  FIREBASE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: pemKey.optional(),
  /** Set by the Firebase Auth Emulator in tests/CI (docs/ARCHITECTURE.md §13.1). */
  FIREBASE_AUTH_EMULATOR_HOST: nonEmpty.optional(),

  // ---- Google Maps Platform server key (D-23) ----
  GOOGLE_MAPS_SERVER_KEY: nonEmpty.optional(),

  /**
   * Maps provider selection (.kiro/steering/provider-credentials.md).
   *
   * `auto` uses Google when a key is present and the deterministic mock when it is
   * not — so a fresh clone works with no credentials at all. `auto` never
   * resolves to the mock in production.
   */
  MAPS_PROVIDER: z.enum(['auto', 'google', 'mock']).default('auto'),

  // ---- Analytics (D-28) ----
  GA4_API_SECRET: nonEmpty.optional(),

  // ---- Google Cloud logging/monitoring (D-27) ----
  GCP_PROJECT_ID: nonEmpty.optional(),
  GCP_LOG_NAME: nonEmpty.default('parthik'),

  // ---- Observability behaviour ----
  //
  // Accepted case-insensitively. `LOG_LEVEL` is a generic name that hosting
  // platforms and CI images commonly set already (often as `INFO`), so being
  // strict about case here breaks builds for reasons that have nothing to do
  // with our configuration.
  LOG_LEVEL: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.toLowerCase() : value),
      z.enum(['debug', 'info', 'warn', 'error'])
    )
    .default('info'),
});

const clientSchema = z.object({
  // Firebase web config. These are public by design — Firebase security comes
  // from server-side token verification and rules, not from hiding these.
  NEXT_PUBLIC_FIREBASE_API_KEY: nonEmpty.optional(),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: nonEmpty.optional(),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: nonEmpty.optional(),
  NEXT_PUBLIC_FIREBASE_APP_ID: nonEmpty.optional(),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: nonEmpty.optional(),
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: nonEmpty.optional(),
  NEXT_PUBLIC_FCM_VAPID_KEY: nonEmpty.optional(),

  // Referrer-restricted, display-only Maps key (never the server key).
  NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: nonEmpty.optional(),

  NEXT_PUBLIC_GA4_MEASUREMENT_ID: nonEmpty.optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  /**
   * Public base URL for stored images (R2 public bucket or its custom domain).
   *
   * OPTIONAL AND UNSET BY DEFAULT. The database stores object keys, not URLs, and
   * decision D-07a (Cloudflare Images vs a custom loader) is still open — so with
   * this absent, `lib/catalog/image.ts` returns null and the UI renders a
   * placeholder rather than a guessed, broken URL.
   */
  NEXT_PUBLIC_ASSET_BASE_URL: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * Treats an empty-string variable as unset.
 *
 * Build systems, CI runners and shell exports routinely produce `KEY=`, and Zod
 * `.default()` only applies to `undefined`. Without this, an empty value fails
 * validation instead of falling back to its default — which is both surprising
 * and, at build time, fatal.
 */
function withoutEmptyValues(source: Record<string, string | undefined>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() === '') continue;
    if (value === undefined) continue;
    cleaned[key] = value;
  }

  return cleaned;
}

/**
 * NEXT_PUBLIC_* values are inlined at build time, so they must be referenced
 * statically rather than looked up dynamically.
 */
function readClientEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
    NEXT_PUBLIC_FCM_VAPID_KEY: process.env.NEXT_PUBLIC_FCM_VAPID_KEY,
    NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY,
    NEXT_PUBLIC_GA4_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ASSET_BASE_URL: process.env.NEXT_PUBLIC_ASSET_BASE_URL,
  };
}

let cachedServerEnv: ServerEnv | null = null;
let cachedClientEnv: ClientEnv | null = null;

/**
 * Validated server configuration. Throws on invalid REQUIRED values so the
 * failure surfaces at startup with an actionable message.
 */
export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse(withoutEmptyValues(process.env));
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment configuration:\n${formatIssues(parsed.error)}\n\n` +
        'See .env.example for the expected keys.'
    );
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

/** Validated public configuration. Safe to call from client components. */
export function getClientEnv(): ClientEnv {
  if (cachedClientEnv) return cachedClientEnv;

  const parsed = clientSchema.safeParse(withoutEmptyValues(readClientEnv()));
  if (!parsed.success) {
    throw new Error(
      `Invalid public environment configuration:\n${formatIssues(parsed.error)}\n\n` +
        'See .env.example for the expected keys.'
    );
  }

  cachedClientEnv = parsed.data;
  return cachedClientEnv;
}

/** Test-only: clears memoised config between cases. */
export function resetEnvCacheForTests(): void {
  cachedServerEnv = null;
  cachedClientEnv = null;
}

export const isProduction = (): boolean => getServerEnv().APP_ENV === 'production';
export const isDevelopment = (): boolean => getServerEnv().APP_ENV === 'development';

/**
 * True when the deployment must never be indexed by search engines
 * (docs/ROUTES.md §1: preview and staging are always noindex).
 */
export const isIndexableEnvironment = (): boolean => getServerEnv().APP_ENV === 'production';
