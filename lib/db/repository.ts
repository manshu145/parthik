import type { Locale } from '@/i18n/routing';
import type { Database } from './client';

/**
 * Repository layer contracts (docs/ARCHITECTURE.md §5.1, §6.1).
 *
 * The repository is the ONLY place that touches the database, which makes it the
 * single chokepoint for three things that are easy to forget elsewhere:
 *
 *   1. TENANT ISOLATION — vendor-scoped queries require a vendor id in the query
 *      itself, so a service that forgets a permission check still cannot return
 *      another vendor's rows (docs/SECURITY.md §4, §9.6).
 *   2. SOFT-DELETE FILTERING — deleted rows are excluded by default.
 *   3. LOCALE FALLBACK — translated fields resolve to English when a Hindi row is
 *      missing, so call sites can never render an empty string (D-33).
 */

/** Every repository receives its connection rather than importing one. */
export interface RepositoryContext {
  db: Database;
}

/**
 * Tenant scope.
 *
 * `vendorId` is derived from the authenticated session's `user_roles`, NEVER from
 * a request body or URL parameter. A mismatch is a security event, not a 404
 * (docs/SECURITY.md §5.4).
 */
export interface VendorScope {
  vendorId: string;
  /** Optional narrowing when a vendor has more than one store. */
  storeId?: string;
}

/** Scope for a customer-owned resource. */
export interface UserScope {
  userId: string;
}

/**
 * Admin scope carries no tenant filter by design — global reads are the point of
 * an admin surface. It is a distinct type so an admin query can never be passed
 * where a vendor-scoped one is required, or vice versa.
 */
export interface AdminScope {
  readonly kind: 'admin';
}

export const ADMIN_SCOPE: AdminScope = { kind: 'admin' };

/** Locale for translated reads. Fallback to English is applied automatically. */
export interface LocaleScope {
  locale: Locale;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/** Cursor pagination, for customer-facing feeds and infinite lists. */
export interface CursorPage {
  cursor?: string | undefined;
  limit?: number | undefined;
}

/** Offset pagination, for admin tables that need page numbers. */
export interface OffsetPage {
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface CursorResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface OffsetResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * Clamps a client-supplied page size.
 *
 * Unbounded queries are how a listing endpoint becomes an accidental data export,
 * so the ceiling is enforced here rather than trusted from the caller.
 */
export function resolveLimit(requested: number | undefined): number {
  if (!requested || requested < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(requested), MAX_PAGE_SIZE);
}

export function resolveOffsetPage(input: OffsetPage): {
  limit: number;
  offset: number;
  page: number;
} {
  const pageSize = resolveLimit(input.pageSize);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  return { limit: pageSize, offset: (page - 1) * pageSize, page };
}

/**
 * Sort allowlist.
 *
 * A raw column name from a client is never interpolated into a query; callers map
 * an allowlisted key to a column instead (docs/API_SPEC.md §1.5).
 */
export function resolveSort<TKey extends string>(
  requested: string | undefined,
  allowed: readonly TKey[],
  fallback: TKey
): { key: TKey; direction: 'asc' | 'desc' } {
  const [rawKey, rawDirection] = (requested ?? '').split(':');
  const key = allowed.includes(rawKey as TKey) ? (rawKey as TKey) : fallback;
  const direction = rawDirection === 'asc' ? 'asc' : 'desc';
  return { key, direction };
}
