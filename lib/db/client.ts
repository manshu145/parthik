import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getServerEnv } from '@/lib/config/env';
import { ConfigurationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import * as schema from '@/db/schema';

/**
 * Database access (decisions D-01, D-02).
 *
 * Connection strategy, in priority order:
 *
 *   1. Cloudflare HYPERDRIVE binding — the production path. Workers cannot open
 *      arbitrary TCP connections, so Hyperdrive provides the pooled connection
 *      and terminates the TCP side (docs/ARCHITECTURE.md §4.2, §7.1).
 *
 *   2. DATABASE_URL — local development, tests and CI, plus migrations, which run
 *      from Node rather than from the Workers runtime.
 *
 * Both are behind one accessor so no module has to care which is in play.
 *
 * DRIVER NOTE: postgres.js is used rather than node-postgres. `pg` pulls in the
 * `pg-cloudflare` socket shim, whose published `dist/index.js` entry does not
 * resolve, which breaks the Workers bundle at build time. postgres.js is also
 * what Cloudflare documents for Hyperdrive. This was caught by the Workers build
 * verification, not in review.
 *
 * TASK 001 scope: connection plumbing only. There is no schema yet, so this
 * client cannot be used for queries — intentionally. Repositories arrive with
 * TASK 002.
 */

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Cloudflare bindings are only reachable inside a request context, so they are
 * read lazily rather than at module scope.
 */
async function getHyperdriveConnectionString(): Promise<string | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const context = await getCloudflareContext({ async: true });
    const hyperdrive = (context.env as { HYPERDRIVE?: { connectionString?: string } }).HYPERDRIVE;
    return hyperdrive?.connectionString ?? null;
  } catch {
    // Not running on Workers (local Node, Vitest, drizzle-kit). Expected.
    return null;
  }
}

function getDirectConnectionString(): string | null {
  return getServerEnv().DATABASE_URL ?? null;
}

/**
 * True when a connection string is available from either source.
 *
 * Reported by /api/v1/health/deep so an absent database reads as a known state
 * rather than a mysterious failure.
 */
export function isDatabaseConfigured(): boolean {
  return getDirectConnectionString() !== null;
}

let client: ReturnType<typeof postgres> | null = null;
let database: Database | null = null;

/**
 * Returns the Drizzle client, creating the connection on first use.
 *
 * @throws ConfigurationError when no connection string is available. Explicitly
 *   NOT a crash at import time — the application must boot without a database so
 *   public pages and health checks still work.
 */
export async function getDb(): Promise<Database> {
  if (database) return database;

  const connectionString = (await getHyperdriveConnectionString()) ?? getDirectConnectionString();

  if (!connectionString) {
    throw new ConfigurationError(
      'No database connection available. Set DATABASE_URL locally, or bind HYPERDRIVE on Workers.'
    );
  }

  client = postgres(connectionString, {
    // Hyperdrive pools upstream, so the in-isolate pool stays small.
    max: 5,
    // Hyperdrive runs the connection in transaction mode, where prepared
    // statements are not reusable across pooled connections.
    prepare: false,
    // Saves a round trip per connection; we do not use custom Postgres types.
    fetch_types: false,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {
      // Postgres NOTICE output is noise in application logs.
    },
  });

  database = drizzle(client, {
    schema,
    // Query logging is opt-in via LOG_LEVEL=debug and must never be enabled in
    // production, where it would risk writing parameter values into logs.
    logger: getServerEnv().LOG_LEVEL === 'debug' && getServerEnv().APP_ENV !== 'production',
  });

  logger.debug('Database client initialised');

  return database;
}

/** Closes the connection. Used by test teardown and scripts, not request handlers. */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
    database = null;
  }
}

export { schema };
