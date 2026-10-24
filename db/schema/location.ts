import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { latitude, longitude, paise, paiseNotNull, primaryId, timestamps } from './_helpers';

/**
 * Delivery zones and serviceability (docs/DATABASE.md §5, decision D-17).
 *
 * D-17 approved: zone-based delivery fee with a ₹199 free-delivery threshold as
 * the initial business rule, **fully admin-configurable per zone**. The threshold
 * is therefore seeded data in this table, never a constant in code.
 *
 * PostGIS `polygon` is documented as reserved and is deliberately NOT created —
 * adding it would require the PostGIS extension for a column V1 does not use.
 * Serviceability is pincode + radius.
 */

export const deliveryZones = pgTable(
  'delivery_zones',
  {
    id: primaryId(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    isActive: boolean('is_active').notNull().default(true),

    centerLatitude: latitude('center_latitude'),
    centerLongitude: longitude('center_longitude'),
    radiusKm: integer('radius_km'),

    // ---- Fee configuration (D-17). All admin-editable. ----
    baseDeliveryFeePaise: paiseNotNull('base_delivery_fee_paise'),
    /** ₹199 = 19900 paise as the initial rule; editable per zone. */
    freeDeliveryThresholdPaise: paise('free_delivery_threshold_paise'),
    minOrderPaise: paiseNotNull('min_order_paise'),
    perKmFeePaise: paise('per_km_fee_paise'),
    maxDeliveryFeePaise: paise('max_delivery_fee_paise'),

    avgDeliveryMinutes: integer('avg_delivery_minutes'),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('delivery_zones_code_key').on(table.code),
    index('delivery_zones_active_idx').on(table.isActive),
    index('delivery_zones_city_idx').on(table.city),
  ]
);

/**
 * Pincode → zone lookup.
 *
 * Serviceability is a single indexed hit here, cached for an hour and
 * re-verified at checkout because zones and stock change between browsing and
 * paying (master spec §11).
 */
export const zonePincodes = pgTable(
  'zone_pincodes',
  {
    id: primaryId(),
    deliveryZoneId: uuid('delivery_zone_id')
      .notNull()
      .references(() => deliveryZones.id, { onDelete: 'cascade' }),
    pincode: text('pincode').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    // A pincode may only map to one ACTIVE zone; historical rows may remain.
    uniqueIndex('zone_pincodes_pincode_active_key')
      .on(table.pincode)
      .where(sql`is_active = true`),
    index('zone_pincodes_zone_idx').on(table.deliveryZoneId),
    index('zone_pincodes_lookup_idx')
      .on(table.pincode)
      .where(sql`is_active = true`),
  ]
);
