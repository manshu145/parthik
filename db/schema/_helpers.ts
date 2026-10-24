import { sql } from 'drizzle-orm';
import { bigint, customType, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Shared column builders (docs/DATABASE.md §1).
 *
 * Centralising these is what makes the conventions actually hold: money is
 * always integer paise, timestamps are always `timestamptz`, and soft-deletable
 * tables all use the same column. A convention that has to be retyped per table
 * is a convention that drifts.
 */

/**
 * Primary key: UUID v7, generated in the database.
 *
 * Time-sortable (so it indexes well and orders naturally), safe to expose, and
 * leaks no business volume the way a sequence would.
 */
export const primaryId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);

/** Foreign-key column without a reference; callers add `.references(...)`. */
export const fk = (name: string) => uuid(name);

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

/** Applied to every table that records state; see §1 "Timestamps". */
export const timestamps = {
  createdAt: createdAt(),
  updatedAt: updatedAt(),
};

/**
 * Soft delete. Permitted on catalog, CMS, vendor, driver, address, coupon, banner
 * and user rows — and explicitly NOT on financial or ledger rows, which are
 * corrected by new rows rather than erased.
 */
export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
};

/** Optional point-in-time column. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Money: integer PAISE, never a float or numeric.
 *
 * `bigint` in Postgres; read as a JavaScript number, which is exact up to
 * 2^53 paise (about ₹90 trillion) — far beyond any realistic order value, and it
 * keeps arithmetic compatible with the branded `Paise` type in lib/money.ts.
 */
export const paise = (name: string) => bigint(name, { mode: 'number' });

/** Money column that must always be present, defaulting to zero. */
export const paiseNotNull = (name: string) => paise(name).notNull().default(0);

/** Percentages: tax rate, commission rate, refund percent. */
export const percentage = (name: string) => numeric(name, { precision: 5, scale: 2 });

/** Coordinates. PostGIS geography is reserved but not used in V1 (D-17). */
export const latitude = (name = 'latitude') => numeric(name, { precision: 9, scale: 6 });
export const longitude = (name = 'longitude') => numeric(name, { precision: 9, scale: 6 });

/**
 * Actor columns (master spec §6). `created_by`/`updated_by` reference users but
 * are declared without a `.references()` here to avoid a circular import between
 * every domain file and identity; the FK is added at the table site where the
 * users table is already imported.
 */
export const actorColumns = {
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
};

/** Optimistic locking, on tables where concurrent edits must be detected. */
export const version = () => sql`1`;

/**
 * `tsvector` column, for PostgreSQL full-text search.
 *
 * Drizzle ships no native `tsvector` builder, and declaring these columns as `text`
 * DOES NOT WORK: a GIN index over `text` has no default operator class, so
 * `CREATE INDEX ... USING gin (search_vector)` fails outright with
 * "data type text has no default operator class for access method gin" — the schema
 * could not be created at all. Caught by scripts/db-integration-check.sh, which
 * applies the schema to a real database.
 *
 * Typed as `string` on the TS side because these columns are generated and never
 * read or written by the application; they exist purely for the search index.
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});
