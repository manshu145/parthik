import type { NextResponse } from 'next/server';
import type { IssuedSessionToken } from './session-token';
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_LIFETIMES_SECONDS,
  type SessionAudience,
} from './session-cookie';

/**
 * Writing and clearing the session cookie.
 *
 * Separate from `session-token.ts` because that file is pure crypto with no
 * knowledge of HTTP — which is what lets it run unchanged in middleware, in route
 * handlers and in unit tests. This file is the only place a Set-Cookie for the
 * session is produced.
 *
 * Unlike the zone cookie, this one is `httpOnly`. The client never needs to read it,
 * and making it readable would expose the session to any injected script — the
 * difference between a defect and a full account takeover.
 */

export function setSessionCookie(
  response: NextResponse,
  token: IssuedSessionToken,
  audience: SessionAudience
): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token.cookieValue,
    ...SESSION_COOKIE_OPTIONS,
    /**
     * `maxAge` matches the signed `exp`, so the browser discards the cookie at the
     * same moment the server would reject it. Letting the two drift apart produces
     * the worst version of this bug: a cookie the browser keeps sending and the
     * server keeps refusing, which presents to the user as being randomly signed out
     * with no way to recover except clearing site data.
     */
    maxAge: SESSION_LIFETIMES_SECONDS[audience],
  });
}

/**
 * Clears the session cookie.
 *
 * `maxAge: 0` with the SAME attributes used to set it. A mismatch in path or the
 * `__Host-` prefix means the browser treats it as a different cookie and the
 * original survives — a sign-out that appears to work and does not.
 */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
}
