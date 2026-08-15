/**
 * Deterministic ids for in-memory fixtures.
 *
 * ⚠️ SHARED ON PURPOSE. The in-memory catalog repository and the in-memory search
 * provider must derive the SAME id for the same fixture, because search returns ids
 * and the catalog hydrates them. Two independent copies of this function would
 * drift, and the failure mode is silent: search would report matches while the
 * catalogue found nothing to show, producing an empty results page with a non-zero
 * count.
 */

/** FNV-1a. Small, dependency-free and stable across runs, processes and platforms. */
export function fnv1a(input: string, seed = 0x811c9dc5): number {
  let hash = seed;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A stable, UUID-shaped id derived from a namespace and key.
 *
 * Shaped like a UUID so nothing downstream has to special-case the format, and
 * derived from the slug so ids never change between requests, processes or deploys —
 * these ids reach URLs, cart rows and cache keys.
 */
export function fixtureId(namespace: string, key: string): string {
  const a = fnv1a(`${namespace}:${key}`).toString(16).padStart(8, '0');
  const b = fnv1a(`${namespace}:${key}`, 0x9e3779b1).toString(16).padStart(8, '0');

  return `${a}-${b.slice(0, 4)}-4${b.slice(4, 7)}-8${a.slice(0, 3)}-${b}${a.slice(0, 4)}`;
}
