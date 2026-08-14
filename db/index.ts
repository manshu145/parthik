/**
 * Database layer entry point.
 *
 * Only `modules/<domain>/<domain>.repository.ts` files may import from here.
 * That boundary is enforced by ESLint (see eslint.config.mjs) and exists so all
 * data access passes through one reviewable chokepoint — where indexes, tenancy
 * scoping and soft-delete filters live (docs/ARCHITECTURE.md §5.1).
 */

export { getDb, closeDb, isDatabaseConfigured, schema } from '@/lib/db/client';
export type { Database } from '@/lib/db/client';
