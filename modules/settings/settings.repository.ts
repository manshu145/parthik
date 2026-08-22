import { inArray } from 'drizzle-orm';
import { adminSettings } from '@/db/schema';
import type { Database } from '@/lib/db/client';
import type { RepositoryContext } from '@/lib/db/repository';

/**
 * Admin settings repository — the only place `admin_settings` is read for runtime use.
 *
 * Separate from the cache and the typed accessors in `index.ts` because the import
 * boundary permits only `*.repository.ts` to touch `@/db` (docs/ARCHITECTURE.md §5.1),
 * and because the caching policy is worth reading independently of the query.
 */
export class DrizzleSettingsRepository {
  private readonly db: Database;

  constructor(context: RepositoryContext) {
    this.db = context.db;
  }

  /**
   * Reads the requested keys in one statement.
   *
   * Deliberately does NOT filter on `required_permission`. This is the RUNTIME read path
   * — the pricing engine asking whether COD is enabled — and it must not depend on who is
   * signed in. The admin-facing read path, where sensitive settings are gated, is a
   * separate concern on the admin surface.
   */
  async readMany(keys: readonly string[]): Promise<Array<{ key: string; value: unknown }>> {
    if (keys.length === 0) return [];

    return this.db
      .select({ key: adminSettings.key, value: adminSettings.value })
      .from(adminSettings)
      .where(inArray(adminSettings.key, [...keys]));
  }
}

export function createSettingsRepository(context: RepositoryContext): DrizzleSettingsRepository {
  return new DrizzleSettingsRepository(context);
}
