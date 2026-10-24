import { DELIVERY_ZONES } from '@/db/seed/reference-data';
import type {
  DeliveryZoneRecord,
  LocationRepository,
  ZoneSummary,
} from './location.repository.types';

/**
 * In-memory location repository.
 *
 * WHY THIS EXISTS: the application must run and pass its full test suite with no
 * external dependencies (.kiro/steering/provider-credentials.md). A managed
 * Postgres provider is still unchosen (D-01a) and no migrations have been
 * generated, so without this a developer cloning the repo cannot exercise the
 * location flow at all, and E2E tests could only assert an error state.
 *
 * It is the same pattern as the mock maps provider: it replaces the I/O, not the
 * rules. Serviceability logic, fee calculation and validation are untouched.
 *
 * SINGLE SOURCE OF TRUTH: the data is `DELIVERY_ZONES` from the seed reference
 * data — the exact rows `pnpm seed` writes to Postgres. Duplicating fixtures here
 * would let the mock and the real database drift apart, which is precisely the
 * bug this kind of fake usually introduces.
 *
 * Refused in production by `createLocationRepository`.
 */

/** Deterministic zone ids: the same code always yields the same id. */
function zoneIdFor(code: string): string {
  // Shaped like a UUID so nothing downstream has to special-case the format.
  const slug = code
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12)
    .padEnd(12, '0');
  return `00000000-0000-4000-8000-${slug}`;
}

function buildZones(): DeliveryZoneRecord[] {
  return DELIVERY_ZONES.map((zone) => ({
    id: zoneIdFor(zone.code),
    code: zone.code,
    name: zone.name,
    city: zone.city,
    state: zone.state,
    isActive: true,
    avgDeliveryMinutes: zone.avgDeliveryMinutes,
    // The seed does not set a centre point, so neither does this.
    centerLatitude: null,
    centerLongitude: null,
    radiusKm: null,
    baseDeliveryFeePaise: zone.baseDeliveryFeePaise,
    freeDeliveryThresholdPaise: zone.freeDeliveryThresholdPaise,
    minOrderPaise: zone.minOrderPaise,
    // Not set in the seed — a per-km charge is a pricing decision that has not
    // been made, so it stays inert rather than being invented here.
    perKmFeePaise: null,
    maxDeliveryFeePaise: null,
  }));
}

export class InMemoryLocationRepository implements LocationRepository {
  private readonly zones: DeliveryZoneRecord[];
  private readonly pincodeIndex: Map<string, DeliveryZoneRecord>;

  constructor(zones: DeliveryZoneRecord[] = buildZones()) {
    this.zones = zones;

    this.pincodeIndex = new Map();
    for (const seedZone of DELIVERY_ZONES) {
      const zone = this.zones.find((candidate) => candidate.code === seedZone.code);
      if (!zone?.isActive) continue;

      for (const pincode of seedZone.pincodes) {
        this.pincodeIndex.set(pincode, zone);
      }
    }
  }

  async findZoneByPincode(pincode: string): Promise<DeliveryZoneRecord | null> {
    return this.pincodeIndex.get(pincode) ?? null;
  }

  async findZoneById(zoneId: string): Promise<DeliveryZoneRecord | null> {
    return this.zones.find((zone) => zone.id === zoneId && zone.isActive) ?? null;
  }

  async listActiveZones(): Promise<ZoneSummary[]> {
    return this.zones
      .filter((zone) => zone.isActive)
      .map((zone) => ({
        id: zone.id,
        code: zone.code,
        name: zone.name,
        city: zone.city,
        state: zone.state,
      }))
      .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
  }

  async listZonePincodes(zoneId: string): Promise<string[]> {
    const zone = this.zones.find((candidate) => candidate.id === zoneId);
    if (!zone) return [];

    return [...this.pincodeIndex.entries()]
      .filter(([, mapped]) => mapped.id === zone.id)
      .map(([pincode]) => pincode)
      .sort();
  }
}

/** All pincodes the in-memory repository considers serviceable. Used by diagnostics. */
export function inMemoryServiceablePincodes(): string[] {
  return DELIVERY_ZONES.flatMap((zone) => zone.pincodes).sort();
}
