import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration (decision D-02).
 *
 * Migrations are FORWARD-ONLY (docs/DATABASE.md §13). A rollback is a new
 * migration, never a reversal, because production data may already depend on the
 * change. Breaking changes follow expand → migrate → contract so that a code
 * rollback never leaves the database ahead of the application.
 *
 * Generated SQL is committed and reviewed in the PR. Hand-editing it is not
 * permitted (master spec §28.8) — the file and the schema would silently diverge,
 * and `drizzle-kit` would then generate the next migration from a snapshot that
 * never matched reality.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dbCredentials: {
    // Migrations run from CI/local Node against the database directly, not
    // through Hyperdrive (which is a Workers-runtime binding).
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
