/**
 * Maps provider contract (decision D-23).
 *
 * Business modules depend on these interfaces, never on Google types. Google is
 * the approved provider and no second provider is being introduced, but the seam
 * still matters: it is where caching, key protection and cost control live, and
 * it keeps `location` module code testable without network access.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface AddressComponents {
  line1?: string;
  line2?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
}

export interface ResolvedPlace {
  placeId: string;
  formattedAddress: string;
  coordinates: Coordinates;
  components: AddressComponents;
}

export interface PlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
}

export interface RouteEstimate {
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteMatrixEntry {
  originIndex: number;
  destinationIndex: number;
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Autocomplete session token.
 *
 * Google bills Places Autocomplete per session rather than per keystroke when a
 * session token is supplied, so passing one is a cost-control requirement, not
 * an optional extra (docs/ARCHITECTURE.md §11.4).
 */
export type PlacesSessionToken = string;

export interface PlacesProvider {
  autocomplete(
    query: string,
    sessionToken: PlacesSessionToken,
    options?: { origin?: Coordinates }
  ): Promise<PlaceSuggestion[]>;

  getPlaceDetails(placeId: string, sessionToken: PlacesSessionToken): Promise<ResolvedPlace | null>;
}

export interface GeocodingProvider {
  reverseGeocode(coordinates: Coordinates): Promise<ResolvedPlace | null>;
  geocodePincode(pincode: string): Promise<ResolvedPlace | null>;
}

export interface RoutesProvider {
  /** Road distance and ETA for a single origin/destination pair. */
  estimateRoute(origin: Coordinates, destination: Coordinates): Promise<RouteEstimate | null>;

  /**
   * Ranks many origins against one destination — used to order candidate drivers
   * for auto-nearest dispatch (D-18).
   *
   * Callers MUST apply a haversine pre-filter first and pass only the top N
   * candidates. A matrix call across every online driver would be needlessly
   * expensive (docs/ARCHITECTURE.md §11.4).
   */
  routeMatrix(origins: Coordinates[], destinations: Coordinates[]): Promise<RouteMatrixEntry[]>;
}

export interface MapsProvider extends PlacesProvider, GeocodingProvider, RoutesProvider {
  isConfigured(): boolean;
}
