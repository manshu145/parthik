import { and, eq } from 'drizzle-orm';
import { deliveryZones, zonePincodes } from '@/db/schema';
import type { RepositoryContext } from '@/lib/db/repository';
import type {
  DeliveryZoneRecord,
  LocationRepository,
  ZoneSummary,
} from './location.repository.types';

/**
 * Location repository (Drizzle).
 *
 * The only file in this module permitted to import `@/db/schema` — enforced by the
 * ESLint import-boundary rules.
 *
 * Two things are applied here rather than left to callers, so they cannot be
 * forgotten: only ACTIVE zones and ACTIVE pincode mappings are ever returned, and
 * `numeric` columns are converted to numbers at this boundary (Drizzle returns
 * them as strings, and a string leaking into fee arithmetic would concatenate
 * instead of add).
 */
export class DrizzleLocationRepository implements LocationRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async findZoneByPincode(pincode: string): Promise<DeliveryZoneRecord | null> {
    const rows = await this.ctx.db
      .select({
        id: deliveryZones.id,
        code: deliveryZones.code,
        name: deliveryZones.name,
        city: deliveryZones.city,
        state: deliveryZones.state,
        isActive: deliveryZones.isActive,
        avgDeliveryMinutes: deliveryZones.avgDeliveryMinutes,
        centerLatitude: deliveryZones.centerLatitude,
        centerLongitude: deliveryZones.centerLongitude,
        radiusKm: deliveryZones.radiusKm,
        baseDeliveryFeePaise: deliveryZones.baseDeliveryFeePaise,
        freeDeliveryThresholdPaise: deliveryZones.freeDeliveryThresholdPaise,
        minOrderPaise: deliveryZones.minOrderPaise,
        perKmFeePaise: deliveryZones.perKmFeePaise,
        maxDeliveryFeePaise: deliveryZones.maxDeliveryFeePaise,
      })
      .from(zonePincodes)
      .innerJoin(deliveryZones, eq(deliveryZones.id, zonePincodes.deliveryZoneId))
      .where(
        and(
          eq(zonePincodes.pincode, pincode),
          // Both the mapping and the zone must be live.
          eq(zonePincodes.isActive, true),
          eq(deliveryZones.isActive, true)
        )
      )
      .limit(1);

    const row = rows[0];
    return row ? toZoneRecord(row) : null;
  }

  async findZoneById(zoneId: string): Promise<DeliveryZoneRecord | null> {
    const rows = await this.ctx.db
      .select({
        id: deliveryZones.id,
        code: deliveryZones.code,
        name: deliveryZones.name,
        city: deliveryZones.city,
        state: deliveryZones.state,
        isActive: deliveryZones.isActive,
        avgDeliveryMinutes: deliveryZones.avgDeliveryMinutes,
        centerLatitude: deliveryZones.centerLatitude,
        centerLongitude: deliveryZones.centerLongitude,
        radiusKm: deliveryZones.radiusKm,
        baseDeliveryFeePaise: deliveryZones.baseDeliveryFeePaise,
        freeDeliveryThresholdPaise: deliveryZones.freeDeliveryThresholdPaise,
        minOrderPaise: deliveryZones.minOrderPaise,
        perKmFeePaise: deliveryZones.perKmFeePaise,
        maxDeliveryFeePaise: deliveryZones.maxDeliveryFeePaise,
      })
      .from(deliveryZones)
      .where(and(eq(deliveryZones.id, zoneId), eq(deliveryZones.isActive, true)))
      .limit(1);

    const row = rows[0];
    return row ? toZoneRecord(row) : null;
  }

  async listActiveZones(): Promise<ZoneSummary[]> {
    return this.ctx.db
      .select({
        id: deliveryZones.id,
        code: deliveryZones.code,
        name: deliveryZones.name,
        city: deliveryZones.city,
        state: deliveryZones.state,
      })
      .from(deliveryZones)
      .where(eq(deliveryZones.isActive, true))
      .orderBy(deliveryZones.city, deliveryZones.name);
  }

  async listZonePincodes(zoneId: string): Promise<string[]> {
    const rows = await this.ctx.db
      .select({ pincode: zonePincodes.pincode })
      .from(zonePincodes)
      .where(and(eq(zonePincodes.deliveryZoneId, zoneId), eq(zonePincodes.isActive, true)))
      .orderBy(zonePincodes.pincode);

    return rows.map((row) => row.pincode);
  }
}

/** Row shape returned by the selects above. */
interface ZoneRow {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string;
  isActive: boolean;
  avgDeliveryMinutes: number | null;
  centerLatitude: string | null;
  centerLongitude: string | null;
  radiusKm: number | null;
  baseDeliveryFeePaise: number;
  freeDeliveryThresholdPaise: number | null;
  minOrderPaise: number;
  perKmFeePaise: number | null;
  maxDeliveryFeePaise: number | null;
}

/**
 * Converts a row to the domain record.
 *
 * `numeric` columns arrive as strings from the driver; converting here means fee
 * arithmetic downstream can never accidentally concatenate.
 */
function toZoneRecord(row: ZoneRow): DeliveryZoneRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    city: row.city,
    state: row.state,
    isActive: row.isActive,
    avgDeliveryMinutes: row.avgDeliveryMinutes,
    centerLatitude: row.centerLatitude !== null ? Number(row.centerLatitude) : null,
    centerLongitude: row.centerLongitude !== null ? Number(row.centerLongitude) : null,
    radiusKm: row.radiusKm,
    baseDeliveryFeePaise: Number(row.baseDeliveryFeePaise),
    freeDeliveryThresholdPaise:
      row.freeDeliveryThresholdPaise !== null ? Number(row.freeDeliveryThresholdPaise) : null,
    minOrderPaise: Number(row.minOrderPaise),
    perKmFeePaise: row.perKmFeePaise !== null ? Number(row.perKmFeePaise) : null,
    maxDeliveryFeePaise: row.maxDeliveryFeePaise !== null ? Number(row.maxDeliveryFeePaise) : null,
  };
}

export function createLocationRepository(ctx: RepositoryContext): LocationRepository {
  return new DrizzleLocationRepository(ctx);
}
