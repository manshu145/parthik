/**
 * Cloudflare Workers bindings available to the application at runtime.
 *
 * Hand-maintained for TASK 001. Once real resources exist this file is
 * regenerated with `pnpm cf:typegen`.
 *
 * Every binding is optional because the foundation must boot and behave
 * predictably when a resource has not been provisioned yet — see
 * lib/db/client.ts and app/api/v1/health/deep/route.ts.
 */
interface CloudflareEnv {
  /** Static assets served by the Worker. */
  ASSETS?: Fetcher;

  /** Pooled PostgreSQL connection (D-01). Enabled in TASK 002. */
  HYPERDRIVE?: {
    connectionString: string;
  };

  /** Object storage (D-07). Enabled when catalog media lands. */
  R2_PUBLIC?: R2Bucket;
  R2_PRIVATE?: R2Bucket;

  /** Background jobs (D-05). Enabled in TASK 010. */
  QUEUE?: Queue;

  /** Plain vars from wrangler.jsonc. */
  APP_ENV?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface CloudflareEnvGlobal extends CloudflareEnv {}
}

export type { CloudflareEnv };
