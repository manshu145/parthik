import { logger } from '@/lib/logger';
import type {
  Coordinates,
  MapsProvider,
  PlaceSuggestion,
  ResolvedPlace,
  RouteEstimate,
} from '@/lib/maps/types';
import { calculateDeliveryFee, estimateDeliveryWindow } from './delivery-fee';
import type { LocationRepository, ZoneSummary } from './location.repository.types';

/**
 * Location and serviceability service (master spec §11).
 *
 * Owns the rule that matters most here: **serviceability is decided
 * server-side, from the zone tables, and is re-verified at checkout** because
 * zones, store hours and stock change between browsing and paying.
 *
 * Dependencies are injected, so the service is unit-testable with a fake
 * repository and the mock maps provider — no database and no credentials required.
 */

export interface ServiceabilityResult {
  isServiceable: boolean;
  pincode: string;
  zone: {
    id: string;
    code: string;
    name: string;
    city: string;
    state: string;
  } | null;
  /** Fee for a hypothetical empty cart, so the UI can advertise the base rate. */
  baseDeliveryFeePaise: number | null;
  freeDeliveryThresholdPaise: number | null;
  minOrderPaise: number | null;
  etaMinutes: number | null;
}

export interface QuoteDeliveryInput {
  pincode: string;
  orderValuePaise: number;
  /** Store coordinates, when a distance-based fee or a real ETA is wanted. */
  storeCoordinates?: Coordinates | null;
  destinationCoordinates?: Coordinates | null;
  storePrepMinutes?: number | null;
}

export interface DeliveryQuote {
  isServiceable: boolean;
  zoneId: string | null;
  deliveryFeePaise: number;
  baseDeliveryFeePaise: number;
  isFreeDelivery: boolean;
  freeDeliveryGapPaise: number | null;
  meetsMinimumOrder: boolean;
  minimumOrderGapPaise: number | null;
  distanceKm: number | null;
  etaMinMinutes: number | null;
  etaMaxMinutes: number | null;
}

export interface LocationServiceDeps {
  repository: LocationRepository;
  maps: MapsProvider;
}

export class LocationService {
  constructor(private readonly deps: LocationServiceDeps) {}

  /**
   * Is this pincode serviceable, and on what terms?
   *
   * An unknown pincode and an inactive mapping both return `isServiceable: false`
   * with no zone. The distinction is deliberately not exposed — the customer only
   * needs to know whether we deliver.
   */
  async checkServiceability(pincode: string): Promise<ServiceabilityResult> {
    const zone = await this.deps.repository.findZoneByPincode(pincode);

    if (!zone) {
      logger.debug('Pincode not serviceable', { pincode });
      return {
        isServiceable: false,
        pincode,
        zone: null,
        baseDeliveryFeePaise: null,
        freeDeliveryThresholdPaise: null,
        minOrderPaise: null,
        etaMinutes: null,
      };
    }

    return {
      isServiceable: true,
      pincode,
      zone: {
        id: zone.id,
        code: zone.code,
        name: zone.name,
        city: zone.city,
        state: zone.state,
      },
      baseDeliveryFeePaise: zone.baseDeliveryFeePaise,
      freeDeliveryThresholdPaise: zone.freeDeliveryThresholdPaise,
      minOrderPaise: zone.minOrderPaise,
      etaMinutes: zone.avgDeliveryMinutes,
    };
  }

  /**
   * Full delivery quote for a given order value.
   *
   * The fee comes from the pure calculator, so the same arithmetic is used by cart
   * preview, checkout and order creation. Distance is ROAD distance from the
   * routing provider — never straight-line, which would understate a real journey
   * and produce a fee the customer would reasonably dispute.
   */
  async quoteDelivery(input: QuoteDeliveryInput): Promise<DeliveryQuote> {
    const zone = await this.deps.repository.findZoneByPincode(input.pincode);

    if (!zone) {
      return {
        isServiceable: false,
        zoneId: null,
        deliveryFeePaise: 0,
        baseDeliveryFeePaise: 0,
        isFreeDelivery: false,
        freeDeliveryGapPaise: null,
        meetsMinimumOrder: false,
        minimumOrderGapPaise: null,
        distanceKm: null,
        etaMinMinutes: null,
        etaMaxMinutes: null,
      };
    }

    // Route lookup only when a distance-based fee or ETA needs it, and only when
    // both endpoints are known — these calls are metered.
    let route: RouteEstimate | null = null;
    const needsRoute =
      Boolean(input.storeCoordinates && input.destinationCoordinates) &&
      (zone.perKmFeePaise !== null || zone.avgDeliveryMinutes === null);

    if (needsRoute && input.storeCoordinates && input.destinationCoordinates) {
      route = await this.deps.maps.estimateRoute(
        input.storeCoordinates,
        input.destinationCoordinates
      );
    }

    const distanceKm = route ? round2(route.distanceMeters / 1000) : null;

    const fee = calculateDeliveryFee({
      zone,
      orderValuePaise: input.orderValuePaise,
      distanceKm,
    });

    const window = estimateDeliveryWindow({
      zoneAvgMinutes: zone.avgDeliveryMinutes,
      routeDurationSeconds: route?.durationSeconds ?? null,
      storePrepMinutes: input.storePrepMinutes ?? null,
    });

    return {
      isServiceable: true,
      zoneId: zone.id,
      deliveryFeePaise: fee.feePaise,
      baseDeliveryFeePaise: fee.baseFeePaise,
      isFreeDelivery: fee.isFreeDelivery,
      freeDeliveryGapPaise: fee.freeDeliveryGapPaise,
      meetsMinimumOrder: fee.meetsMinimumOrder,
      minimumOrderGapPaise: fee.minimumOrderGapPaise,
      distanceKm,
      etaMinMinutes: window?.minMinutes ?? null,
      etaMaxMinutes: window?.maxMinutes ?? null,
    };
  }

  /**
   * Resolves a browser coordinate to an address and its serviceability.
   *
   * The pincode comes from the geocoder, never from the client, so a client cannot
   * claim to be in a serviceable area by supplying one.
   */
  async resolveCoordinates(coordinates: Coordinates): Promise<{
    place: ResolvedPlace | null;
    serviceability: ServiceabilityResult | null;
  }> {
    const place = await this.deps.maps.reverseGeocode(coordinates);

    if (!place?.components.pincode) {
      return { place, serviceability: null };
    }

    const serviceability = await this.checkServiceability(place.components.pincode);
    return { place, serviceability };
  }

  /**
   * Resolves a chosen Places suggestion to an address and its serviceability.
   */
  async resolvePlace(
    placeId: string,
    sessionToken: string
  ): Promise<{ place: ResolvedPlace | null; serviceability: ServiceabilityResult | null }> {
    const place = await this.deps.maps.getPlaceDetails(placeId, sessionToken);

    if (!place?.components.pincode) {
      return { place, serviceability: null };
    }

    const serviceability = await this.checkServiceability(place.components.pincode);
    return { place, serviceability };
  }

  async suggestAddresses(
    query: string,
    sessionToken: string,
    origin?: Coordinates
  ): Promise<PlaceSuggestion[]> {
    return this.deps.maps.autocomplete(query, sessionToken, origin ? { origin } : {});
  }

  async listServiceableZones(): Promise<ZoneSummary[]> {
    return this.deps.repository.listActiveZones();
  }

  async estimateRoute(
    origin: Coordinates,
    destination: Coordinates
  ): Promise<RouteEstimate | null> {
    return this.deps.maps.estimateRoute(origin, destination);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function createLocationService(deps: LocationServiceDeps): LocationService {
  return new LocationService(deps);
}
