import { cookies } from 'next/headers';
import { parseZoneCookie, ZONE_COOKIE_NAME } from '@/lib/http/zone-cookie';
import { NO_LOCATION, type SelectedLocation } from './types';

/**
 * Reads the chosen delivery location on the server.
 *
 * Called by the shop layouts so the header shows the correct label on FIRST PAINT.
 * Reading it client-side instead would flash "Select location" on every navigation,
 * which reads as though the choice was lost.
 *
 * The cookie is client-writable, so this is display data only. Anything that
 * actually depends on the zone — pricing, availability, checkout — re-resolves it
 * from the pincode server-side.
 */
export async function getCurrentLocation(): Promise<SelectedLocation> {
  const store = await cookies();
  const payload = parseZoneCookie(store.get(ZONE_COOKIE_NAME)?.value);

  if (!payload) return NO_LOCATION;

  return {
    label: payload.label,
    pincode: payload.pincode,
    city: payload.city,
    zoneId: payload.zoneId,
    isServiceable: payload.isServiceable,
    // The cookie does not record how the location was picked, and it does not
    // matter after the fact — 'manual' is the honest neutral value.
    source: 'manual',
  };
}
