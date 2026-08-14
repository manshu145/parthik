/**
 * Database schema barrel.
 *
 * DELIBERATELY EMPTY. Schema definition is TASK 002 and requires the approved
 * design in docs/DATABASE.md; migration generation additionally requires
 * explicit authorization (docs/DATABASE.md §14).
 *
 * This file exists so the Drizzle client and drizzle.config.ts typecheck today.
 * Running `pnpm db:generate` against it correctly produces no migrations.
 *
 * When TASK 002 begins, tables are added as one file per domain and re-exported
 * here, for example:
 *
 *   export * from './identity';
 *   export * from './catalog';
 *   export * from './commerce';
 */

export {};
