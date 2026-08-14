import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration (decision D-02).
 *
 * IMPORTANT — TASK 001 scope: there is deliberately NO schema and there are NO
 * migrations. `db/schema/` is an empty barrel so the client and this config
 * typecheck. Running `db:generate` today would correctly produce nothing.
 *
 * Schema definition is TASK 002 and migration generation requires explicit
 * authorization (docs/DATABASE.md §14).
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
