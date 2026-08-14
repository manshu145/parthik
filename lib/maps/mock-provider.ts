import { ConfigurationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { haversineMetres } from './haversine';
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
 * Deterministic mock Google Maps provider.
 *
 * Purpose: the application must be fully buildable, runnable and testable with NO
 * external credentials (.kiro/steering/provider-credentials.md). This replaces the
 * network call and nothing else — validation, serviceability rules and fee
 * calculation run identically against it.
 *
 * DETERMINISTIC means the same input always produces the same output, so tests
 * can assert concrete values instead of "something came back". There is no
 * randomness and no clock dependency anywhere in this file.
 *
 * The fixture set is deliberately aligned with the seeded delivery zone
 * (Indore, pincodes 452001–452003 — see db/seed/reference-data.ts), so a developer
 * running the mock gets a *serviceable* result and can exercise the happy path.
 * It also includes deliberately UNSERVICEABLE pincodes, because the
 * "we don't deliver here" path is the one most likely to be shipped broken.
 */

/** Anchor: Indore city centre, matching the seeded zone. */
const ORIGIN: Coordinates = { latitude: 22.719568, longitude: 75.857727 };

interface MockPlace {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  formattedAddress: string;
  coordinates: Coordinates;
  components: AddressComponents;
}

/**
 * Fixture places. Pincodes 452001–452003 are serviceable in the seed; 110001 and
 * 400001 are intentionally outside it.
 */
const PLACES: readonly MockPlace[] = [
  {
    placeId: 'mock-place-vijay-nagar',
    primaryText: 'Vijay Nagar',
    secondaryText: 'Indore, Madhya Pradesh',
    formattedAddress: 'Vijay Nagar, Indore, Madhya Pradesh 452010, India',
    coordinates: { latitude: 22.7533, longitude: 75.8937 },
    components: {
      line2: 'Vijay Nagar',
      city: 'Indore',
      state: 'Madhya Pradesh',
      pincode: '452010',
      country: 'India',
    },
  },
  {
    placeId: 'mock-place-mg-road',
    primaryText: 'MG Road',
    secondaryText: 'Indore, Madhya Pradesh',
    formattedAddress: '12 MG Road, Indore, Madhya Pradesh 452001, India',
    coordinates: { latitude: 22.7196, longitude: 75.8577 },
    components: {
      line1: '12 MG Road',
      city: 'Indore',
      state: 'Madhya Pradesh',
      pincode: '452001',
      country: 'India',
    },
  },
  {
    placeId: 'mock-place-palasia',
    primaryText: 'Palasia Square',
    secondaryText: 'Indore, Madhya Pradesh',
    formattedAddress: 'Palasia Square, Indore, Madhya Pradesh 452002, India',
    coordinates: { latitude: 22.7244, longitude: 75.8839 },
    components: {
      line2: 'Palasia',
      city: 'Indore',
      state: 'Madhya Pradesh',
      pincode: '452002',
      country: 'India',
    },
  },
  {
    placeId: 'mock-place-rajwada',
    primaryText: 'Rajwada Palace',
    secondaryText: 'Indore, Madhya Pradesh',
    formattedAddress: 'Rajwada, Indore, Madhya Pradesh 452003, India',
    coordinates: { latitude: 22.7177, longitude: 75.8545 },
    components: {
      landmark: 'Rajwada Palace',
      city: 'Indore',
      state: 'Madhya Pradesh',
      pincode: '452003',
      country: 'India',
    },
  },
  {
    // Outside the seeded zone on purpose: exercises the unserviceable path.
    placeId: 'mock-place-connaught',
    primaryText: 'Connaught Place',
    secondaryText: 'New Delhi, Delhi',
    formattedAddress: 'Connaught Place, New Delhi, Delhi 110001, India',
    coordinates: { latitude: 28.6315, longitude: 77.2167 },
    components: {
      line2: 'Connaught Place',
      city: 'New Delhi',
      state: 'Delhi',
      pincode: '110001',
      country: 'India',
    },
  },
  {
    placeId: 'mock-place-fort-mumbai',
    primaryText: 'Fort',
    secondaryText: 'Mumbai, Maharashtra',
    formattedAddress: 'Fort, Mumbai, Maharashtra 400001, India',
    coordinates: { latitude: 18.9346, longitude: 72.8356 },
    components: {
      line2: 'Fort',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
      country: 'India',
    },
  },
];

const BY_PLACE_ID = new Map(PLACES.map((place) => [place.placeId, place]));
const BY_PINCODE = new Map(PLACES.map((place) => [place.components.pincode ?? '', place]));

/**
 * Average two-wheeler speed used to derive a duration from a distance.
 *
 * 18 km/h is a realistic Indian city figure including traffic and stops. Fixed so
 * the mock is deterministic.
 */
const AVERAGE_SPEED_KMH = 18;

/**
 * Road distance is longer than straight-line distance. 1.35 is a common urban
 * detour factor and keeps mock estimates plausible rather than optimistic.
 */
const ROAD_DETOUR_FACTOR = 1.35;

class MockMapsProvider implements MapsProvider {
  readonly name = 'mock';

  isConfigured(): boolean {
    // The mock needs no credentials — that is the entire point.
    return true;
  }

  async autocomplete(
    query: string,
    sessionToken: PlacesSessionToken,
    options: { origin?: Coordinates } = {}
  ): Promise<PlaceSuggestion[]> {
    // Session token is still REQUIRED, so call sites are exercised against the
    // same contract the real provider enforces for billing reasons.
    if (!sessionToken) {
      throw new ConfigurationError(
        'A Places session token is required, even for the mock provider.'
      );
    }

    const trimmed = query.trim().toLowerCase();
    if (trimmed.length < 3) return [];

    const matches = PLACES.filter(
      (place) =>
        place.primaryText.toLowerCase().includes(trimmed) ||
        place.secondaryText.toLowerCase().includes(trimmed) ||
        place.formattedAddress.toLowerCase().includes(trimmed) ||
        (place.components.pincode ?? '').startsWith(trimmed)
    );

    // Ranked nearest-first when an origin is supplied, mirroring locationBias.
    const ranked = options.origin
      ? [...matches].sort(
          (a, b) =>
            haversineMetres(options.origin!, a.coordinates) -
            haversineMetres(options.origin!, b.coordinates)
        )
      : matches;

    return ranked.slice(0, 5).map((place) => ({
      placeId: place.placeId,
      primaryText: place.primaryText,
      secondaryText: place.secondaryText,
    }));
  }

  async getPlaceDetails(
    placeId: string,
    sessionToken: PlacesSessionToken
  ): Promise<ResolvedPlace | null> {
    if (!sessionToken) {
      throw new ConfigurationError(
        'A Places session token is required, even for the mock provider.'
      );
    }

    const place = BY_PLACE_ID.get(placeId);
    if (!place) return null;

    return toResolvedPlace(place);
  }

  async reverseGeocode(coordinates: Coordinates): Promise<ResolvedPlace | null> {
    // Nearest fixture wins, so a browser-detected coordinate resolves sensibly.
    let nearest: MockPlace | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const place of PLACES) {
      const distance = haversineMetres(coordinates, place.coordinates);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = place;
      }
    }

    // Beyond 100 km from every fixture, report no result rather than a
    // nonsensical match — the real API behaves this way too.
    if (!nearest || nearestDistance > 100_000) return null;

    return toResolvedPlace(nearest);
  }

  async geocodePincode(pincode: string): Promise<ResolvedPlace | null> {
    const place = BY_PINCODE.get(pincode);
    if (!place) return null;
    return toResolvedPlace(place);
  }

  async estimateRoute(
    origin: Coordinates,
    destination: Coordinates
  ): Promise<RouteEstimate | null> {
    const straightLine = haversineMetres(origin, destination);

    // Same coordinates: a zero-length route is not a route.
    if (straightLine < 1) {
      return { distanceMeters: 0, durationSeconds: 0 };
    }

    const distanceMeters = Math.round(straightLine * ROAD_DETOUR_FACTOR);
    const durationSeconds = Math.round((distanceMeters / 1000 / AVERAGE_SPEED_KMH) * 3600);

    return { distanceMeters, durationSeconds };
  }

  async routeMatrix(
    origins: Coordinates[],
    destinations: Coordinates[]
  ): Promise<RouteMatrixEntry[]> {
    const entries: RouteMatrixEntry[] = [];

    for (const [originIndex, origin] of origins.entries()) {
      for (const [destinationIndex, destination] of destinations.entries()) {
        const estimate = await this.estimateRoute(origin, destination);
        if (!estimate) continue;

        entries.push({
          originIndex,
          destinationIndex,
          distanceMeters: estimate.distanceMeters,
          durationSeconds: estimate.durationSeconds,
        });
      }
    }

    return entries;
  }
}

function toResolvedPlace(place: MockPlace): ResolvedPlace {
  return {
    placeId: place.placeId,
    formattedAddress: place.formattedAddress,
    coordinates: place.coordinates,
    components: place.components,
  };
}

export const mockMapsProvider: MapsProvider & { name: string } = new MockMapsProvider();

/** Exposed for tests and for the development diagnostics surface. */
export const MOCK_PLACE_FIXTURES = PLACES;
export const MOCK_ORIGIN = ORIGIN;

export function describeMockFixtures(): Array<{ pincode: string; label: string }> {
  logger.debug('Mock maps fixtures requested');
  return PLACES.map((place) => ({
    pincode: place.components.pincode ?? '',
    label: `${place.primaryText}, ${place.components.city ?? ''}`,
  }));
}
