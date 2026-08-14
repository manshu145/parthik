import { describe, expect, it } from 'vitest';
import { mockMapsProvider, MOCK_PLACE_FIXTURES } from '@/lib/maps/mock-provider';
import { ConfigurationError } from '@/lib/errors';

/**
 * Mock maps provider tests.
 *
 * The point of these is DETERMINISM. A mock that returns plausible-but-varying data
 * is worse than no mock, because tests written against it can only assert loose
 * shapes and real regressions slip through. Every assertion here pins a concrete
 * value.
 */

const SESSION = 'test-session-token-1234';

describe('mock maps provider — configuration', () => {
  it('reports itself as configured without any credentials', () => {
    expect(mockMapsProvider.isConfigured()).toBe(true);
  });
});

describe('mock maps provider — autocomplete', () => {
  it('returns identical results for identical input', async () => {
    const first = await mockMapsProvider.autocomplete('Indore', SESSION);
    const second = await mockMapsProvider.autocomplete('Indore', SESSION);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('matches on area name', async () => {
    const results = await mockMapsProvider.autocomplete('Palasia', SESSION);

    expect(results).toHaveLength(1);
    expect(results[0]!.placeId).toBe('mock-place-palasia');
    expect(results[0]!.primaryText).toBe('Palasia Square');
  });

  it('matches on pincode prefix', async () => {
    const results = await mockMapsProvider.autocomplete('45200', SESSION);

    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.every((result) => result.placeId.startsWith('mock-place-'))).toBe(true);
  });

  it('returns nothing for a query below the minimum length', async () => {
    // Mirrors the real API and the route's validation: short queries are noise.
    expect(await mockMapsProvider.autocomplete('MG', SESSION)).toEqual([]);
    expect(await mockMapsProvider.autocomplete('', SESSION)).toEqual([]);
  });

  it('is case insensitive', async () => {
    const lower = await mockMapsProvider.autocomplete('palasia', SESSION);
    const upper = await mockMapsProvider.autocomplete('PALASIA', SESSION);

    expect(lower).toEqual(upper);
  });

  it('caps the number of suggestions', async () => {
    const results = await mockMapsProvider.autocomplete('India', SESSION);

    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('requires a session token even though it costs nothing here', async () => {
    // Enforced against the mock on purpose: if the mock accepted a missing token,
    // a call site could omit it and the cost regression would only show up on a
    // real Google bill.
    await expect(mockMapsProvider.autocomplete('Palasia', '')).rejects.toThrow(ConfigurationError);
  });

  it('ranks results nearest-first when an origin is supplied', async () => {
    const origin = { latitude: 18.9346, longitude: 72.8356 }; // Mumbai
    const results = await mockMapsProvider.autocomplete('India', SESSION, { origin });

    // Mumbai's own fixture must come first when biasing from Mumbai.
    expect(results[0]!.placeId).toBe('mock-place-fort-mumbai');
  });
});

describe('mock maps provider — place details', () => {
  it('resolves a known place id to a full address', async () => {
    const place = await mockMapsProvider.getPlaceDetails('mock-place-mg-road', SESSION);

    expect(place).not.toBeNull();
    expect(place!.components.pincode).toBe('452001');
    expect(place!.components.city).toBe('Indore');
    expect(place!.coordinates).toEqual({ latitude: 22.7196, longitude: 75.8577 });
  });

  it('returns null for an unknown place id', async () => {
    expect(await mockMapsProvider.getPlaceDetails('does-not-exist', SESSION)).toBeNull();
  });

  it('requires a session token', async () => {
    await expect(mockMapsProvider.getPlaceDetails('mock-place-mg-road', '')).rejects.toThrow(
      ConfigurationError
    );
  });
});

describe('mock maps provider — reverse geocoding', () => {
  it('resolves a coordinate to the nearest fixture', async () => {
    // Very close to the MG Road fixture.
    const place = await mockMapsProvider.reverseGeocode({
      latitude: 22.7197,
      longitude: 75.8578,
    });

    expect(place!.components.pincode).toBe('452001');
  });

  it('is deterministic', async () => {
    const coordinates = { latitude: 22.73, longitude: 75.87 };

    expect(await mockMapsProvider.reverseGeocode(coordinates)).toEqual(
      await mockMapsProvider.reverseGeocode(coordinates)
    );
  });

  it('returns null when far from every fixture', async () => {
    // Middle of the Bay of Bengal: the real API also returns nothing useful here,
    // and inventing a match would hide bugs in the "no address" UI path.
    const place = await mockMapsProvider.reverseGeocode({ latitude: 15, longitude: 88 });

    expect(place).toBeNull();
  });

  it('resolves a serviceable Indore coordinate to a seeded pincode', async () => {
    const place = await mockMapsProvider.reverseGeocode({
      latitude: 22.7244,
      longitude: 75.8839,
    });

    // Must land in the seeded zone so the development happy path is reachable.
    expect(['452001', '452002', '452003']).toContain(place!.components.pincode);
  });
});

describe('mock maps provider — pincode geocoding', () => {
  it('resolves a fixture pincode', async () => {
    const place = await mockMapsProvider.geocodePincode('452002');

    expect(place!.placeId).toBe('mock-place-palasia');
  });

  it('returns null for an unknown pincode', async () => {
    expect(await mockMapsProvider.geocodePincode('999999')).toBeNull();
  });
});

describe('mock maps provider — routes', () => {
  it('returns a deterministic distance and duration', async () => {
    const origin = { latitude: 22.7196, longitude: 75.8577 };
    const destination = { latitude: 22.7244, longitude: 75.8839 };

    const first = await mockMapsProvider.estimateRoute(origin, destination);
    const second = await mockMapsProvider.estimateRoute(origin, destination);

    expect(first).toEqual(second);
    expect(first!.distanceMeters).toBeGreaterThan(0);
    expect(first!.durationSeconds).toBeGreaterThan(0);
  });

  it('reports road distance as longer than straight-line distance', async () => {
    const origin = { latitude: 22.7196, longitude: 75.8577 };
    const destination = { latitude: 22.7533, longitude: 75.8937 };

    const estimate = await mockMapsProvider.estimateRoute(origin, destination);

    // Roughly 5.3 km straight line; the detour factor must push it above that.
    // A mock that returned straight-line distance would make the fee look cheaper
    // in development than in production.
    expect(estimate!.distanceMeters).toBeGreaterThan(5_300);
  });

  it('returns a zero-length route for identical coordinates', async () => {
    const point = { latitude: 22.7196, longitude: 75.8577 };
    const estimate = await mockMapsProvider.estimateRoute(point, point);

    expect(estimate).toEqual({ distanceMeters: 0, durationSeconds: 0 });
  });

  it('derives duration from distance at a fixed speed', async () => {
    const estimate = await mockMapsProvider.estimateRoute(
      { latitude: 22.7196, longitude: 75.8577 },
      { latitude: 22.7533, longitude: 75.8937 }
    );

    // 18 km/h: duration in hours must equal distance in km / 18.
    const expectedSeconds = Math.round((estimate!.distanceMeters / 1000 / 18) * 3600);
    expect(estimate!.durationSeconds).toBe(expectedSeconds);
  });

  it('produces one matrix entry per origin/destination pair', async () => {
    const origins = [
      { latitude: 22.7196, longitude: 75.8577 },
      { latitude: 22.7533, longitude: 75.8937 },
    ];
    const destinations = [{ latitude: 22.7244, longitude: 75.8839 }];

    const entries = await mockMapsProvider.routeMatrix(origins, destinations);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.originIndex)).toEqual([0, 1]);
    expect(entries.every((entry) => entry.destinationIndex === 0)).toBe(true);
  });
});

describe('mock maps provider — fixtures', () => {
  it('includes both serviceable and unserviceable pincodes', () => {
    const pincodes = MOCK_PLACE_FIXTURES.map((place) => place.components.pincode);

    // Serviceable in the seed.
    expect(pincodes).toContain('452001');
    // Deliberately outside it, so the "we don't deliver here" path is reachable
    // in development without editing fixtures.
    expect(pincodes).toContain('110001');
  });

  it('gives every fixture a unique place id', () => {
    const ids = MOCK_PLACE_FIXTURES.map((place) => place.placeId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every fixture a pincode', () => {
    // A fixture without a pincode could not be used for serviceability at all.
    expect(MOCK_PLACE_FIXTURES.every((place) => Boolean(place.components.pincode))).toBe(true);
  });
});
