import type { NextResponse } from 'next/server';
import { getServerEnv } from '@/lib/config/env';

/**
 * Delivery-location cookie.
 *
 * The chosen location must survive a reload, and it must be readable on the server
 * so catalogue pages can be rendered for the right zone.
 *
 * NOT httpOnly: the client reads it to show the header label without an extra
 * round trip. That is safe because it holds no secret and grants no privilege —
 * the zone is re-resolved server-side from the pincode on every request that
 * matters, and serviceability is re-verified at checkout (master spec §11). A
 * tampered cookie can change what a customer *sees*, never what they can *buy*.
 */

export const ZONE_COOKIE_NAME = 'parthik_location';

/** 30 days: long enough to be useful, short enough that a stale zone self-heals. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface ZoneCookiePayload {
  pincode: string;
  zoneId: string | null;
  city: string | null;
  label: string;
  isServiceable: boolean;
}

export function serializeZoneCookie(payload: ZoneCookiePayload): string {
  return JSON.stringify(payload);
}

/**
 * Parses the cookie, returning null on anything unexpected.
 *
 * Client-writable input is never trusted: a malformed or hand-edited value must
 * degrade to "no location chosen" rather than throw during render.
 */
export function parseZoneCookie(raw: string | undefined): ZoneCookiePayload | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const value = parsed as Record<string, unknown>;

    if (typeof value.pincode !== 'string' || !/^[1-9][0-9]{5}$/.test(value.pincode)) {
      return null;
    }
    if (typeof value.label !== 'string' || value.label.length > 120) return null;
    if (typeof value.isServiceable !== 'boolean') return null;

    return {
      pincode: value.pincode,
      zoneId: typeof value.zoneId === 'string' ? value.zoneId : null,
      city: typeof value.city === 'string' ? value.city : null,
      label: value.label,
      isServiceable: value.isServiceable,
    };
  } catch {
    return null;
  }
}

export function setZoneCookie(response: NextResponse, payload: ZoneCookiePayload): void {
  response.cookies.set({
    name: ZONE_COOKIE_NAME,
    value: serializeZoneCookie(payload),
    path: '/',
    maxAge: MAX_AGE_SECONDS,
    httpOnly: false,
    sameSite: 'lax',
    // Secure in production only, so local http development still works.
    secure: getServerEnv().APP_ENV === 'production',
  });
}

export function clearZoneCookie(response: NextResponse): void {
  response.cookies.set({ name: ZONE_COOKIE_NAME, value: '', path: '/', maxAge: 0 });
}
