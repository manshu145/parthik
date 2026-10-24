import type { CatalogSortOption } from './view';

/**
 * URL search-param helpers for catalog browsing.
 *
 * Filters and sorting live in the URL, not in component state, so results are
 * shareable, crawlable and survive a reload (docs/ROUTES.md §4). That means every
 * control is a LINK, which also makes the whole toolbar work without JavaScript.
 */

export type CatalogSearchParams = Record<string, string | string[] | undefined>;

/** Flattens Next's `searchParams` into single values, ignoring repeats. */
export function firstValue(params: CatalogSearchParams, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Builds a href with one parameter changed.
 *
 * `cursor` is always dropped: a cursor from the previous ordering or filter set is
 * meaningless once either changes, and keeping it would silently show the wrong
 * page. Passing null removes the parameter entirely.
 */
export function buildCatalogHref(
  basePath: string,
  params: CatalogSearchParams,
  changes: Record<string, string | null>
): string {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (key === 'cursor') continue;
    const flat = Array.isArray(value) ? value[0] : value;
    if (flat !== undefined && flat !== '') next.set(key, flat);
  }

  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }

  const query = next.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export interface SortOptionInput {
  value: string;
  label: string;
}

/** Sort options as links, with the active one flagged. */
export function buildSortOptions(
  basePath: string,
  params: CatalogSearchParams,
  options: SortOptionInput[],
  defaultValue: string
): CatalogSortOption[] {
  const active = firstValue(params, 'sort') ?? defaultValue;

  return options.map((option) => ({
    value: option.value,
    label: option.label,
    isActive: option.value === active,
    href: buildCatalogHref(basePath, params, {
      // The default is expressed by ABSENCE, so the canonical URL of an unsorted
      // page has no `sort` parameter and does not compete with itself for indexing.
      sort: option.value === defaultValue ? null : option.value,
    }),
  }));
}
