import type { Coordinates } from './types';

const EARTH_RADIUS_METRES = 6_371_000;

/**
 * Great-circle distance between two points.
 *
 * Exists so we can pre-filter candidates locally before spending money on a
 * Google Route Matrix call (D-18 dispatch, docs/ARCHITECTURE.md §11.4). It is
 * straight-line distance, so it is used for RANKING and filtering only — never
 * for a customer-facing delivery distance or a distance-based fee, which must
 * use real road distance from the Routes API.
 */
export function haversineMetres(a: Coordinates, b: Coordinates): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(b.longitude - a.longitude);

  const h =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Returns the `limit` nearest items, nearest first. */
export function nearest<T>(
  origin: Coordinates,
  items: readonly T[],
  getCoordinates: (item: T) => Coordinates,
  limit: number
): Array<{ item: T; distanceMetres: number }> {
  return items
    .map((item) => ({ item, distanceMetres: haversineMetres(origin, getCoordinates(item)) }))
    .sort((a, b) => a.distanceMetres - b.distanceMetres)
    .slice(0, Math.max(0, limit));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
