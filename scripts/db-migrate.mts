/* eslint-disable no-console */
/**
 * Applies db/bootstrap.sql and then the committed migrations, in that order.
 *
 * WHY THIS WRAPPER EXISTS: the migration DDL references `pg_trgm` (search indexes) and
 * `uuidv7()` (every primary-key default), and Postgres resolves a column default's
 * function at DDL time. `drizzle-kit migrate` alone therefore FAILS on a fresh database
 * — and `uuidv7()` is built in only from PostgreSQL 18, while the documented floor is 16
 * and both D-01a candidates (Neon, Supabase) run 16/17.
 *
 * Making the bootstrap a separate manual step would work exactly once, in development,
 * and then be forgotten on the first real deploy. Binding the two together means the
 * ordering cannot be got wrong.
 *
 * Run with: pnpm db:migrate
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');
const BOOTSTRAP_FILE = path.join(process.cwd(), 'db', 'bootstrap.sql');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error(
      'DATABASE_URL is not set.\n\n' +
        'Migrations connect DIRECTLY to Postgres, not through Hyperdrive — Hyperdrive is a\n' +
        'Workers-runtime binding and is not available to a Node process.'
    );
    process.exit(1);
  }

  // `max: 1` because migrations must run on a single connection: DDL in one session
  // while another pooled connection races ahead is how a half-applied schema happens.
  const sql = postgres(url, { max: 1, onnotice: (notice) => console.log(`  ${notice.message}`) });

  try {
    console.log('Applying bootstrap (extensions, uuidv7)…');
    const bootstrap = await readFile(BOOTSTRAP_FILE, 'utf8');
    await sql.unsafe(bootstrap);
    console.log('✅ Bootstrap applied.');

    console.log('Applying migrations…');
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR });
    console.log('✅ Migrations applied.');
  } finally {
    await sql.end();
  }
}

await main();
