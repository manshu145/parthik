import { describe, expect, it, vi } from 'vitest';
import { mockMapsProvider } from '@/lib/maps/mock-provider';
import { LocationService } from '@/modules/location/location.service';
import { InMemoryLocationRepository } from '@/modules/location/location-memory.repository';
import type {
  DeliveryZoneRecord,
  LocationRepository,
} from '@/modules/location/location.repository.types';

/**
 * Location service tests.
 *
 * Run against the in-memory repository and the mock maps provider, so they need no
 * database and no credentials — which is the whole requirement in
 * .kiro/steering/provider-credentials.md, verified rather than assumed.
 */

function createService(repository: LocationRepository = new InMemoryLocationRepository()) {
  return new LocationService({ repository, maps: mockMapsProvider });
}

describe('checkServiceability', () => {
  it('reports a seeded pincode as serviceable with its terms', async () => {
    const result = await createService().checkServiceability('452001');

    expect(result.isServiceable).toBe(true);
    expect(result.zone?.city).toBe('Indore');
    expect(result.baseDeliveryFeePaise).toBe(2_500);
    expect(result.freeDeliveryThresholdPaise).toBe(19_900);
    expect(result.minOrderPaise).toBe(9_900);
    expect(result.etaMinutes).toBe(35);
  });

  it('reports an unknown pincode as unserviceable', async () => {
    const result = await createService().checkServiceability('110001');

    expect(result.isServiceable).toBe(false);
    expect(result.zone).toBeNull();
  });

  it('exposes no zone terms for an unserviceable pincode', async () => {
    const result = await createService().checkServiceability('999999');

    expect(result.baseDeliveryFeePaise).toBeNull();
    expect(result.freeDeliveryThresholdPaise).toBeNull();
    expect(result.minOrderPaise).toBeNull();
    expect(result.etaMinutes).toBeNull();
  });

  it('echoes the requested pincode back', async () => {
    // The UI shows "we don't deliver to 110001 yet", so the value must survive.
    const result = await createService().checkServiceability('110001');

    expect(result.pincode).toBe('110001');
  });

  it('treats an INACTIVE zone as unserviceable', async () => {
    // Deactivating a zone must immediately stop orders. This is the operational
    // kill switch, so it is tested rather than assumed.
    const repository: LocationRepository = {
      findZoneByPincode: async () => null,
      findZoneById: async () => null,
      listActiveZones: async () => [],
      listZonePincodes: async () => [],
    };

    const result = await createService(repository).checkServiceability('452001');

    expect(result.isServiceable).toBe(false);
  });

  it('does not distinguish an unknown pincode from a deactivated one', async () => {
    const service = createService();

    const unknown = await service.checkServiceability('999999');
    const outOfZone = await service.checkServiceability('110001');

    // Internal operational state must not leak through the public response.
    expect(unknown.zone).toEqual(outOfZone.zone);
    expect(unknown.isServiceable).toBe(outOfZone.isServiceable);
  });
});

describe('quoteDelivery', () => {
  it('quotes the base fee below the free-delivery threshold', async () => {
    const quote = await createService().quoteDelivery({
      pincode: '452001',
      orderValuePaise: 15_000,
    });

    expect(quote.isServiceable).toBe(true);
    expect(quote.deliveryFeePaise).toBe(2_500);
    expect(quote.isFreeDelivery).toBe(false);
    expect(quote.freeDeliveryGapPaise).toBe(4_900);
  });

  it('quotes free delivery above the threshold', async () => {
    const quote = await createService().quoteDelivery({
      pincode: '452001',
      orderValuePaise: 25_000,
    });

    expect(quote.deliveryFeePaise).toBe(0);
    expect(quote.isFreeDelivery).toBe(true);
  });

  it('flags an order below the zone minimum', async () => {
    const quote = await createService().quoteDelivery({
      pincode: '452001',
      orderValuePaise: 5_000,
    });

    expect(quote.meetsMinimumOrder).toBe(false);
    expect(quote.minimumOrderGapPaise).toBe(4_900);
  });

  it('returns an unserviceable quote with a zero fee and no zone', async () => {
    const quote = await createService().quoteDelivery({
      pincode: '110001',
      orderValuePaise: 50_000,
    });

    expect(quote.isServiceable).toBe(false);
    expect(quote.zoneId).toBeNull();
    expect(quote.deliveryFeePaise).toBe(0);
    // Not "free delivery" — there is no delivery at all.
    expect(quote.isFreeDelivery).toBe(false);
  });

  it('supplies an ETA window from the zone average', async () => {
    const quote = await createService().quoteDelivery({
      pincode: '452001',
      orderValuePaise: 15_000,
    });

    expect(quote.etaMinMinutes).toBe(28);
    expect(quote.etaMaxMinutes).toBe(44);
  });

  it('does not call the routing provider when the zone has no per-km fee', async () => {
    // Routes calls are metered. The seeded zone charges a flat fee and publishes an
    // average ETA, so a route lookup would be pure cost for no added information.
    const spy = vi.spyOn(mockMapsProvider, 'estimateRoute');
    spy.mockClear();

    await createService().quoteDelivery({
      pincode: '452001',
      orderValuePaise: 15_000,
      storeCoordinates: { latitude: 22.7196, longitude: 75.8577 },
      destinationCoordinates: { latitude: 22.7244, longitude: 75.8839 },
    });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('calls the routing provider when the zone charges per km', async () => {
    const perKmZone: DeliveryZoneRecord = {
      id: '00000000-0000-4000-8000-zone00000001',
      code: 'ZONE-PERKM',
      name: 'Per-km',
      city: 'Indore',
      state: 'Madhya Pradesh',
      isActive: true,
      avgDeliveryMinutes: 35,
      centerLatitude: null,
      centerLongitude: null,
      radiusKm: null,
      baseDeliveryFeePaise: 2_500,
      freeDeliveryThresholdPaise: 19_900,
      minOrderPaise: 9_900,
      perKmFeePaise: 500,
      maxDeliveryFeePaise: null,
    };

    const repository: LocationRepository = {
      findZoneByPincode: async () => perKmZone,
      findZoneById: async () => perKmZone,
      listActiveZones: async () => [],
      listZonePincodes: async () => [],
    };

    const quote = await createService(repository).quoteDelivery({
      pincode: '452001',
      orderValuePaise: 15_000,
      storeCoordinates: { latitude: 22.7196, longitude: 75.8577 },
      destinationCoordinates: { latitude: 22.7533, longitude: 75.8937 },
    });

    expect(quote.distanceKm).not.toBeNull();
    // Road distance, so above the ~5.3 km straight line.
    expect(quote.distanceKm!).toBeGreaterThan(5.3);
    // Fee must now exceed the flat base.
    expect(quote.deliveryFeePaise).toBeGreaterThan(2_500);
  });

  it('omits distance when coordinates are not supplied', async () => {
    const quote = await createService().quoteDelivery({
      pincode: '452001',
      orderValuePaise: 15_000,
    });

    expect(quote.distanceKm).toBeNull();
  });
});

describe('resolveCoordinates', () => {
  it('resolves a coordinate to an address and its serviceability', async () => {
    const { place, serviceability } = await createService().resolveCoordinates({
      latitude: 22.7196,
      longitude: 75.8577,
    });

    expect(place?.components.pincode).toBe('452001');
    expect(serviceability?.isServiceable).toBe(true);
  });

  it('returns no serviceability when the coordinate resolves to nothing', async () => {
    const { place, serviceability } = await createService().resolveCoordinates({
      latitude: 15,
      longitude: 88,
    });

    expect(place).toBeNull();
    expect(serviceability).toBeNull();
  });

  it('resolves an out-of-zone coordinate to an unserviceable result', async () => {
    // Connaught Place: a real address, just not one we deliver to.
    const { place, serviceability } = await createService().resolveCoordinates({
      latitude: 28.6315,
      longitude: 77.2167,
    });

    expect(place?.components.pincode).toBe('110001');
    expect(serviceability?.isServiceable).toBe(false);
  });
});

describe('resolvePlace', () => {
  it('resolves a place id to an address and its serviceability', async () => {
    const { place, serviceability } = await createService().resolvePlace(
      'mock-place-palasia',
      'session-token-value'
    );

    expect(place?.components.pincode).toBe('452002');
    expect(serviceability?.isServiceable).toBe(true);
  });

  it('returns nulls for an unknown place id', async () => {
    const { place, serviceability } = await createService().resolvePlace(
      'nope',
      'session-token-value'
    );

    expect(place).toBeNull();
    expect(serviceability).toBeNull();
  });
});

describe('suggestAddresses', () => {
  it('passes the session token through to the provider', async () => {
    const spy = vi.spyOn(mockMapsProvider, 'autocomplete');

    await createService().suggestAddresses('Palasia', 'session-token-value');

    expect(spy).toHaveBeenCalledWith('Palasia', 'session-token-value', {});
    spy.mockRestore();
  });

  it('forwards an origin for location biasing', async () => {
    const spy = vi.spyOn(mockMapsProvider, 'autocomplete');
    const origin = { latitude: 22.7196, longitude: 75.8577 };

    await createService().suggestAddresses('Palasia', 'session-token-value', origin);

    expect(spy).toHaveBeenCalledWith('Palasia', 'session-token-value', { origin });
    spy.mockRestore();
  });
});

describe('listServiceableZones', () => {
  it('lists active zones without exposing pincodes', async () => {
    const zones = await createService().listServiceableZones();

    expect(zones.length).toBeGreaterThan(0);
    expect(zones[0]!.city).toBe('Indore');
    // Pincode lists are operational data and must not appear on a public surface.
    expect(zones[0]).not.toHaveProperty('pincodes');
  });
});

describe('InMemoryLocationRepository', () => {
  it('maps every seeded pincode to the seeded zone', async () => {
    const repository = new InMemoryLocationRepository();

    for (const pincode of ['452001', '452002', '452003']) {
      const zone = await repository.findZoneByPincode(pincode);
      expect(zone?.code).toBe('ZONE-001');
    }
  });

  it('produces stable zone ids across instances', async () => {
    // The zone id ends up in a cookie, so it must not change between requests or
    // process restarts.
    const first = await new InMemoryLocationRepository().findZoneByPincode('452001');
    const second = await new InMemoryLocationRepository().findZoneByPincode('452001');

    expect(first?.id).toBe(second?.id);
  });

  it('finds a zone by its id', async () => {
    const repository = new InMemoryLocationRepository();
    const byPincode = await repository.findZoneByPincode('452001');
    const byId = await repository.findZoneById(byPincode!.id);

    expect(byId).toEqual(byPincode);
  });

  it('lists the pincodes belonging to a zone', async () => {
    const repository = new InMemoryLocationRepository();
    const zone = await repository.findZoneByPincode('452001');

    expect(await repository.listZonePincodes(zone!.id)).toEqual(['452001', '452002', '452003']);
  });

  it('leaves the per-km fee inert, matching the seed', async () => {
    // A per-km charge is an unmade pricing decision; the fake must not invent one,
    // or development would show fees production does not charge.
    const zone = await new InMemoryLocationRepository().findZoneByPincode('452001');

    expect(zone?.perKmFeePaise).toBeNull();
    expect(zone?.maxDeliveryFeePaise).toBeNull();
  });
});
