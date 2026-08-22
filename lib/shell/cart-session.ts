import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { getCurrentActor } from '@/lib/auth/current-actor';
import {
  CART_COOKIE_NAME,
  clearCartCookie,
  parseCartCookie,
  setCartCookie,
} from '@/lib/http/cart-cookie';
import { logger } from '@/lib/logger';
import { getCartStore, type CartIntent } from '@/modules/cart';

/**
 * Where a cart lives, resolved once per request.
 *
 * The cart has two homes and the choice is not arbitrary:
 *
 *   SIGNED IN  → Postgres, so the cart follows the customer across devices and
 *                survives cleared cookies.
 *   GUEST      → the cookie, so browsing works with no account and no database write
 *                per anonymous visitor.
 *
 * Every route handler goes through here rather than reading the cookie directly, so
 * "which store am I using?" is decided in ONE place. When it was decided per route,
 * adding the database would have meant changing four handlers and hoping none was
 * missed — and a missed one silently keeps writing to the cookie while reads come from
 * Postgres, which presents as a cart that forgets items.
 */

export type CartOwner = { kind: 'user'; userId: string } | { kind: 'guest' };

export interface LoadedCart {
  owner: CartOwner;
  intent: CartIntent;
  /** Passed to the service so user-scoped coupon rules can be evaluated. */
  userId: string | null;
}

async function readCookieIntent(): Promise<CartIntent> {
  const store = await cookies();
  const payload = parseCartCookie(store.get(CART_COOKIE_NAME)?.value);

  return { storeId: payload.storeId, lines: payload.lines, couponCode: payload.couponCode };
}

/**
 * Resolves the owner and loads their cart.
 *
 * A signed-in customer with no database falls back to the cookie rather than seeing an
 * empty cart, which keeps local development usable.
 */
export async function loadCart(): Promise<LoadedCart> {
  const actor = await getCurrentActor();

  if (!actor) {
    return { owner: { kind: 'guest' }, intent: await readCookieIntent(), userId: null };
  }

  const store = await getCartStore();

  if (!store) {
    return { owner: { kind: 'guest' }, intent: await readCookieIntent(), userId: actor.userId };
  }

  return {
    owner: { kind: 'user', userId: actor.userId },
    intent: await store.load(actor.userId),
    userId: actor.userId,
  };
}

/**
 * Persists the intent to wherever the owner's cart lives.
 *
 * The response is still required for the guest path, because a cookie can only be
 * written on a response.
 */
export async function persistCart(
  response: NextResponse,
  owner: CartOwner,
  intent: CartIntent
): Promise<void> {
  if (owner.kind === 'guest') {
    setCartCookie(response, intent);
    return;
  }

  const store = await getCartStore();
  if (!store) {
    // Should be unreachable: a `user` owner is only produced when a store exists.
    logger.warn('Cart owner is a user but no cart store is available', { userId: owner.userId });
    return;
  }

  await store.save(owner.userId, intent);
}

/** Empties the cart for whichever owner this request has. */
export async function clearCart(response: NextResponse, owner: CartOwner): Promise<void> {
  if (owner.kind === 'guest') {
    clearCartCookie(response);
    return;
  }

  const store = await getCartStore();
  await store?.clear(owner.userId);
}

/**
 * Merges the guest cookie cart into the user's cart at sign-in, then clears the cookie.
 *
 * WHY THIS MATTERS: without it, a customer who fills a cart and then signs in to check
 * out watches their cart empty at the moment they authenticate — the single worst place
 * to lose it. `CartService.merge` owns the rules, including D-11: if the two carts
 * belong to different stores the USER cart wins, because silently mixing stores creates
 * a cart that cannot be ordered.
 *
 * Best-effort by design. A merge failure must never prevent sign-in; the customer keeps
 * their account and loses at most some cart lines, which is recoverable. The reverse is
 * not.
 */
export async function mergeGuestCartOnSignIn(
  response: NextResponse,
  userId: string
): Promise<void> {
  try {
    const guestIntent = await readCookieIntent();
    if (guestIntent.lines.length === 0) return;

    const store = await getCartStore();
    if (!store) return;

    const { getCartService } = await import('@/modules/cart');
    const [service, userIntent] = await Promise.all([getCartService(), store.load(userId)]);

    await store.save(userId, service.merge(userIntent, guestIntent));

    // Cleared only after a successful save, so a failure leaves the guest cart intact
    // and the merge can be retried on the next sign-in.
    clearCartCookie(response);
  } catch (error) {
    logger.warn('Guest cart merge failed; sign-in continues', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
