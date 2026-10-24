import { getServerEnv } from '@/lib/config/env';
import { ConfigurationError, ProviderError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type {
  AddressComponents,
  Coordinates,
  MapsProvider,
  PlaceSuggestion,
  PlacesSessionToken,
  ResolvedPlace,
  RouteEstimate,
  RouteMatrixEntry,
} from './types';

/**
 * Google Maps Platform adapter (decision D-23).
 *
 * All calls here are SERVER-SIDE. The server key is IP-restricted and must never
 * reach the browser; the browser only ever gets the separate referrer-restricted
 * display key (docs/SECURITY.md §9.1).
 *
 * TASK 001 scope: the adapter and its cost controls. The `location` module that
 * consumes it is TASK 005.
 */

const PLACES_BASE = 'https://places.googleapis.com/v1';
const GEOCODING_BASE = 'https://maps.googleapis.com/maps/api/geocode/json';
const ROUTES_BASE = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const ROUTE_MATRIX_BASE = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

/** Bias results to India; this is a hyperlocal Indian marketplace. */
const REGION = 'in';

/** Hard ceiling on a matrix request so a bug cannot produce a huge bill. */
const MAX_MATRIX_ELEMENTS = 100;

export class GoogleMapsProvider implements MapsProvider {
  constructor(private readonly keyOverride?: string) {}

  isConfigured(): boolean {
    return Boolean(this.keyOverride ?? getServerEnv().GOOGLE_MAPS_SERVER_KEY);
  }

  private key(): string {
    const key = this.keyOverride ?? getServerEnv().GOOGLE_MAPS_SERVER_KEY;
    if (!key) {
      throw new ConfigurationError(
        'GOOGLE_MAPS_SERVER_KEY is not configured. Location features are unavailable.'
      );
    }
    return key;
  }

  async autocomplete(
    query: string,
    sessionToken: PlacesSessionToken,
    options: { origin?: Coordinates } = {}
  ): Promise<PlaceSuggestion[]> {
    if (query.trim().length < 3) return [];

    const body: Record<string, unknown> = {
      input: query,
      sessionToken,
      regionCode: REGION,
      includedRegionCodes: [REGION],
    };

    if (options.origin) {
      body.locationBias = {
        circle: {
          center: { latitude: options.origin.latitude, longitude: options.origin.longitude },
          radius: 50_000,
        },
      };
    }

    const data = await this.post<{
      suggestions?: Array<{
        placePrediction?: {
          placeId: string;
          structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
          };
        };
      }>;
    }>(`${PLACES_BASE}/places:autocomplete`, body, 'suggestions.placePrediction');

    return (data.suggestions ?? []).flatMap((suggestion) => {
      const prediction = suggestion.placePrediction;
      if (!prediction) return [];
      return [
        {
          placeId: prediction.placeId,
          primaryText: prediction.structuredFormat?.mainText?.text ?? '',
          secondaryText: prediction.structuredFormat?.secondaryText?.text ?? '',
        },
      ];
    });
  }

  async getPlaceDetails(
    placeId: string,
    sessionToken: PlacesSessionToken
  ): Promise<ResolvedPlace | null> {
    const url = new URL(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`);
    url.searchParams.set('sessionToken', sessionToken);
    url.searchParams.set('regionCode', REGION);

    const response = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': this.key(),
        'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents',
      },
    });

    if (response.status === 404) return null;
    if (!response.ok) throw this.providerError('places-details', response.status);

    const data = (await response.json()) as {
      id?: string;
      formattedAddress?: string;
      location?: { latitude: number; longitude: number };
      addressComponents?: Array<{ types: string[]; longText?: string; shortText?: string }>;
    };

    if (!data.location) return null;

    return {
      placeId: data.id ?? placeId,
      formattedAddress: data.formattedAddress ?? '',
      coordinates: { latitude: data.location.latitude, longitude: data.location.longitude },
      components: mapPlacesComponents(data.addressComponents ?? []),
    };
  }

  async reverseGeocode(coordinates: Coordinates): Promise<ResolvedPlace | null> {
    const url = new URL(GEOCODING_BASE);
    url.searchParams.set('latlng', `${coordinates.latitude},${coordinates.longitude}`);
    url.searchParams.set('region', REGION);
    url.searchParams.set('key', this.key());

    return this.geocodeRequest(url, coordinates);
  }

  async geocodePincode(pincode: string): Promise<ResolvedPlace | null> {
    const url = new URL(GEOCODING_BASE);
    url.searchParams.set('components', `postal_code:${pincode}|country:IN`);
    url.searchParams.set('key', this.key());

    return this.geocodeRequest(url);
  }

  private async geocodeRequest(url: URL, fallback?: Coordinates): Promise<ResolvedPlace | null> {
    // Geocoding results are highly cacheable — addresses rarely move.
    const response = await fetch(url, { next: { revalidate: 86_400 } } as RequestInit);

    if (!response.ok) throw this.providerError('geocoding', response.status);

    const data = (await response.json()) as {
      status: string;
      results?: Array<{
        place_id: string;
        formatted_address: string;
        geometry?: { location?: { lat: number; lng: number } };
        address_components?: Array<{ types: string[]; long_name: string; short_name: string }>;
      }>;
    };

    if (data.status === 'ZERO_RESULTS') return null;
    if (data.status !== 'OK') {
      logger.warn('Geocoding returned non-OK status', { status: data.status });
      return null;
    }

    const result = data.results?.[0];
    if (!result) return null;

    const location = result.geometry?.location;

    return {
      placeId: result.place_id,
      formattedAddress: result.formatted_address,
      coordinates: location
        ? { latitude: location.lat, longitude: location.lng }
        : (fallback ?? { latitude: 0, longitude: 0 }),
      components: mapGeocodingComponents(result.address_components ?? []),
    };
  }

  async estimateRoute(
    origin: Coordinates,
    destination: Coordinates
  ): Promise<RouteEstimate | null> {
    const data = await this.post<{
      routes?: Array<{ distanceMeters?: number; duration?: string }>;
    }>(
      ROUTES_BASE,
      {
        origin: { location: { latLng: toLatLng(origin) } },
        destination: { location: { latLng: toLatLng(destination) } },
        travelMode: 'TWO_WHEELER',
        routingPreference: 'TRAFFIC_AWARE',
        regionCode: REGION,
      },
      'routes.distanceMeters,routes.duration'
    );

    const route = data.routes?.[0];
    if (!route?.distanceMeters) return null;

    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: parseDuration(route.duration),
    };
  }

  async routeMatrix(
    origins: Coordinates[],
    destinations: Coordinates[]
  ): Promise<RouteMatrixEntry[]> {
    const elements = origins.length * destinations.length;
    if (elements === 0) return [];

    if (elements > MAX_MATRIX_ELEMENTS) {
      // Refuse rather than silently spend. Callers must pre-filter (D-18).
      throw new ProviderError(
        'route-matrix',
        `Refusing ${elements} matrix elements; pre-filter candidates to at most ${MAX_MATRIX_ELEMENTS}`
      );
    }

    const data = await this.post<
      Array<{
        originIndex?: number;
        destinationIndex?: number;
        distanceMeters?: number;
        duration?: string;
        condition?: string;
      }>
    >(
      ROUTE_MATRIX_BASE,
      {
        origins: origins.map((origin) => ({
          waypoint: { location: { latLng: toLatLng(origin) } },
        })),
        destinations: destinations.map((destination) => ({
          waypoint: { location: { latLng: toLatLng(destination) } },
        })),
        travelMode: 'TWO_WHEELER',
        routingPreference: 'TRAFFIC_AWARE',
      },
      'originIndex,destinationIndex,distanceMeters,duration,condition'
    );

    return (Array.isArray(data) ? data : [])
      .filter((entry) => entry.condition === 'ROUTE_EXISTS' && entry.distanceMeters !== undefined)
      .map((entry) => ({
        originIndex: entry.originIndex ?? 0,
        destinationIndex: entry.destinationIndex ?? 0,
        distanceMeters: entry.distanceMeters ?? 0,
        durationSeconds: parseDuration(entry.duration),
      }));
  }

  private async post<T>(url: string, body: unknown, fieldMask: string): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': this.key(),
        'X-Goog-FieldMask': fieldMask,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw this.providerError(
        url.includes('Matrix') ? 'route-matrix' : 'google-maps',
        response.status
      );
    }

    return (await response.json()) as T;
  }

  private providerError(provider: string, status: number): ProviderError {
    return new ProviderError(provider, `Request failed (${status})`);
  }
}

function toLatLng(coordinates: Coordinates): { latitude: number; longitude: number } {
  return { latitude: coordinates.latitude, longitude: coordinates.longitude };
}

/** Google returns durations as a protobuf duration string, e.g. "930s". */
function parseDuration(duration: string | undefined): number {
  if (!duration) return 0;
  return Number.parseInt(duration.replace('s', ''), 10) || 0;
}

function mapPlacesComponents(
  components: Array<{ types: string[]; longText?: string; shortText?: string }>
): AddressComponents {
  return mapComponents(
    components.map((component) => ({
      types: component.types,
      value: component.longText ?? component.shortText ?? '',
    }))
  );
}

function mapGeocodingComponents(
  components: Array<{ types: string[]; long_name: string; short_name: string }>
): AddressComponents {
  return mapComponents(
    components.map((component) => ({ types: component.types, value: component.long_name }))
  );
}

function mapComponents(components: Array<{ types: string[]; value: string }>): AddressComponents {
  const find = (type: string): string | undefined =>
    components.find((component) => component.types.includes(type))?.value;

  const result: AddressComponents = {};

  const line1 = [find('street_number'), find('route') ?? find('sublocality_level_2')]
    .filter(Boolean)
    .join(' ');

  if (line1) result.line1 = line1;

  const line2 = find('sublocality_level_1') ?? find('sublocality') ?? find('neighborhood');
  if (line2) result.line2 = line2;

  const landmark = find('point_of_interest') ?? find('premise');
  if (landmark) result.landmark = landmark;

  const city = find('locality') ?? find('administrative_area_level_3');
  if (city) result.city = city;

  const state = find('administrative_area_level_1');
  if (state) result.state = state;

  const pincode = find('postal_code');
  if (pincode) result.pincode = pincode;

  const country = find('country');
  if (country) result.country = country;

  return result;
}

export const mapsProvider: MapsProvider = new GoogleMapsProvider();
