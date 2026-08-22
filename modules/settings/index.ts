import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { DrizzleSettingsRepository } from './settings.repository';

/**
 * Admin settings reader (master spec §34, docs/DATABASE.md §11).
 *
 * Settings are DATA, not constants. The ₹199 free-delivery threshold, the COD ceiling and
 * the driver cash limit are all business decisions that must change without a deploy
 * (D-17, D-12) — so nothing in the codebase may hardcode them.
 *
 * Two properties this file exists to guarantee:
 *
 *   TYPED   Every key has a declared type and a documented fallback, so a missing or
 *           malformed row degrades to a known-safe value instead of `undefined` flowing
 *           into a price calculation.
 *   CACHED  Read through a short cache (docs/ARCHITECTURE.md §8.2 specifies 60s), because
 *           checkout reads several of these on every quote and they change rarely. The
 *           window is deliberately short so maintenance mode and a COD switch propagate
 *           quickly.
 *
 * ⚠️ This is a MODULE-LEVEL cache, not the shared application cache. D-03a (cache
 * provider) is still open, so there is nowhere shared to put it yet. The consequence is
 * that each isolate warms its own copy and a change can take up to the TTL to be visible
 * everywhere — acceptable for settings, and revisited when D-03a lands.
 */

const CACHE_TTL_MS = 60_000;

/** Every setting the application reads, with its type and fallback. */
export const SETTING_DEFAULTS = {
  /** D-12: caps exposure on a single cash-on-delivery order. */
  'cod.enabled': true,
  'cod.max_order_value_paise': 250_000,
  'cod.driver_cash_limit_paise': 500_000,
  'cod.deposit_grace_hours': 24,

  /** D-16: how long an unpaid order holds its stock reservation. */
  'order.payment_timeout_minutes': 15,

  /** Maintenance mode, read on every request through this cache. */
  'system.maintenance_mode': false,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];

interface CacheEntry {
  values: Partial<Record<SettingKey, unknown>>;
  expiresAt: number;
}

const CACHE_KEY = '__parthikSettingsCache';

type GlobalWithCache = typeof globalThis & { [CACHE_KEY]?: CacheEntry };

/**
 * Cached on `globalThis` rather than in a module variable.
 *
 * Next.js compiles route handlers and server components into separate module graphs, so a
 * module-level cache would be warmed twice and the two copies could disagree about
 * whether COD is enabled — a difference the customer would see as checkout offering an
 * option the API then refuses.
 */
function readCache(): CacheEntry | null {
  const entry = (globalThis as GlobalWithCache)[CACHE_KEY];
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry;
}

export function resetSettingsCacheForTests(): void {
  delete (globalThis as GlobalWithCache)[CACHE_KEY];
}

/** Invalidates the cache immediately, for the admin settings write path. */
export function invalidateSettingsCache(): void {
  delete (globalThis as GlobalWithCache)[CACHE_KEY];
}

async function loadAll(): Promise<Partial<Record<SettingKey, unknown>>> {
  const cached = readCache();
  if (cached) return cached.values;

  // Without a database the defaults apply. That is the correct degradation: the defaults
  // are the documented launch values, so local development behaves like a fresh install.
  if (!isDatabaseConfigured()) return {};

  try {
    const db = await getDb();
    const repository = new DrizzleSettingsRepository({ db });
    const keys = Object.keys(SETTING_DEFAULTS) as SettingKey[];

    const rows = await repository.readMany(keys);

    const values: Partial<Record<SettingKey, unknown>> = {};
    for (const row of rows) values[row.key as SettingKey] = row.value;

    (globalThis as GlobalWithCache)[CACHE_KEY] = {
      values,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    return values;
  } catch (error) {
    // A settings read must never be the reason checkout fails. Falling back to the
    // documented defaults is safer than a 500, and it is logged so the outage is visible.
    logger.warn('Could not read admin settings; using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * Reads one setting, coerced to the type of its default.
 *
 * A row whose stored value does not match the expected type falls back to the default
 * rather than propagating. A string where a number belongs would otherwise reach
 * arithmetic and produce a nonsense total silently.
 */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const values = await loadAll();
  const fallback = SETTING_DEFAULTS[key];
  const raw = values[key];

  if (raw === undefined || raw === null) return fallback;

  if (typeof fallback === 'number') {
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    return (Number.isFinite(parsed) ? parsed : fallback) as SettingValue<K>;
  }

  if (typeof fallback === 'boolean') {
    if (typeof raw === 'boolean') return raw as SettingValue<K>;
    if (raw === 'true') return true as SettingValue<K>;
    if (raw === 'false') return false as SettingValue<K>;
    return fallback;
  }

  return raw as SettingValue<K>;
}

/** Reads several settings in one pass, so a quote makes a single cache hit. */
export async function getSettings<K extends SettingKey>(
  ...keys: K[]
): Promise<{ [P in K]: SettingValue<P> }> {
  await loadAll();

  const result = {} as { [P in K]: SettingValue<P> };
  for (const key of keys) result[key] = await getSetting(key);

  return result;
}
