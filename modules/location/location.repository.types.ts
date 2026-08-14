import type { ZoneFeeConfig } from './delivery-fee';

/**
 * Location repository contract.
 *
 * Services depend on this interface, never on Drizzle types, which is what lets
 * the serviceability logic be unit-tested without a database — important while the
 * managed Postgres provider is still unchosen (D-01a).
 */

/** A delivery zone with everything serviceability and fee calculation need. */
export interface DeliveryZoneRecord extends ZoneFeeConfig {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string;
  isActive: boolean;
  avgDeliveryMinutes: number | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusKm: number | null;
}

/** Zone summary for the public "where do you deliver" list. */
export interface ZoneSummary {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string;
}

export interface LocationRepository {
  /**
   * Resolves an ACTIVE zone for a pincode.
   *
   * Returns null when the pincode is unknown or its mapping is inactive — both mean
   * "not serviceable", and the caller must not distinguish them for the customer.
   */
  findZoneByPincode(pincode: string): Promise<DeliveryZoneRecord | null>;

  findZoneById(zoneId: string): Promise<DeliveryZoneRecord | null>;

  /** Active zones, for the public serviceable-areas list. */
  listActiveZones(): Promise<ZoneSummary[]>;

  /** Distinct active pincodes in a zone, used by diagnostics and admin tooling. */
  listZonePincodes(zoneId: string): Promise<string[]>;
}
