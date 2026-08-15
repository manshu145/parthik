import type { NextResponse } from 'next/server';
import { getServerEnv } from '@/lib/config/env';

/**
 * Guest cart cookie — the credential-free persistence fallback.
 *
 * WHY THIS EXISTS: the approved architecture stores carts in Postgres
 * (`carts`/`cart_items`), and that remains authoritative. But no database is
 * provisioned yet (D-01a), and an in-memory cart would NOT survive between Workers
 * isolates — the preview would appear to drop items at random, which is worse than
 * having no cart at all.
 *
 * WHAT IS AND IS NOT TRUSTED. The cookie holds variant ids and quantities only —
 * the customer's *intent*. Every price, name and stock figure is re-read from the
 * database on every read, so a hand-edited cookie can change what someone intends
 * to buy, never what it costs. That is the same rule the Postgres cart follows:
 * `unit_price_paise_snapshot` exists to DETECT a price change, never to charge one.
 *
 * NOT httpOnly, for the same reason as the location cookie: the client reads the
 * item count for the header badge without a round trip, and the value grants no
 * privilege.
 */

export const CART_COOKIE_NAME = 'parthik_cart';

/** 30 days: long enough to be useful, short enough that stale carts self-clear. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Hard ceiling on distinct lines.
 *
 * Cookies are capped around 4KB by every browser. Exceeding it does not error — the
 * cookie is silently dropped and the cart vanishes. Bounding the line count keeps
 * the payload far below the limit.
 */
export const MAX_COOKIE_CART_LINES = 40;

export interface CartCookieLine {
  variantId: string;
  quantity: number;
}

export interface CartCookiePayload {
  /** D-11: one store per cart. Null until the first item is added. */
  storeId: string | null;
  lines: CartCookieLine[];
  /** Applied coupon code, re-validated on every read. */
  couponCode: string | null;
}

export const EMPTY_CART_COOKIE: CartCookiePayload = {
  storeId: null,
  lines: [],
  couponCode: null,
};

export function serializeCartCookie(payload: CartCookiePayload): string {
  // Compact keys: the 4KB budget is shared with every other cookie on the domain.
  return JSON.stringify({
    s: payload.storeId,
    l: payload.lines.map((line) => [line.variantId, line.quantity]),
    c: payload.couponCode,
  });
}

/**
 * Parses the cookie, returning an EMPTY cart on anything unexpected.
 *
 * Never throws and never returns partial garbage: a malformed cookie must degrade
 * to "empty cart", not break every page that renders the header badge.
 */
export function parseCartCookie(raw: string | undefined): CartCookiePayload {
  if (!raw) return { ...EMPTY_CART_COOKIE, lines: [] };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY_CART_COOKIE, lines: [] };

    const value = parsed as { s?: unknown; l?: unknown; c?: unknown };

    const lines: CartCookieLine[] = Array.isArray(value.l)
      ? value.l
          .map((entry) => {
            if (!Array.isArray(entry) || entry.length < 2) return null;
            const [variantId, quantity] = entry as [unknown, unknown];

            if (typeof variantId !== 'string' || variantId.length === 0) return null;
            if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
              return null;
            }

            return { variantId, quantity };
          })
          .filter((line): line is CartCookieLine => line !== null)
          .slice(0, MAX_COOKIE_CART_LINES)
      : [];

    return {
      storeId: typeof value.s === 'string' && value.s.length > 0 ? value.s : null,
      lines,
      couponCode:
        typeof value.c === 'string' && value.c.length > 0 && value.c.length <= 40 ? value.c : null,
    };
  } catch {
    return { ...EMPTY_CART_COOKIE, lines: [] };
  }
}

export function setCartCookie(response: NextResponse, payload: CartCookiePayload): void {
  // An empty cart clears the cookie rather than storing an empty shell.
  if (payload.lines.length === 0) {
    clearCartCookie(response);
    return;
  }

  response.cookies.set({
    name: CART_COOKIE_NAME,
    value: serializeCartCookie(payload),
    path: '/',
    maxAge: MAX_AGE_SECONDS,
    httpOnly: false,
    sameSite: 'lax',
    secure: getServerEnv().APP_ENV === 'production',
  });
}

export function clearCartCookie(response: NextResponse): void {
  response.cookies.set({ name: CART_COOKIE_NAME, value: '', path: '/', maxAge: 0 });
}
