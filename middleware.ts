import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import {
  LOCALE_HEADER,
  PATHNAME_HEADER,
  REQUEST_ID_HEADER,
  resolveRequestId,
} from '@/lib/http/request-context';
import { applySecurityHeaders } from '@/lib/http/security-headers';
import {
  canonicalRedirectFor,
  classifySurface,
  homePathForSurface,
  isNoindexPath,
  isSafeRedirectTarget,
  requiresSession,
  stripLocalePrefix,
} from '@/lib/http/route-access';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session-cookie';
import { readSessionClaimsForRouting } from '@/lib/auth/session-token';
import { landingSurfaceForRoles, surfacesForRoles } from '@/modules/identity/identity.policy';

/**
 * Composed middleware (docs/ROUTES.md §10).
 *
 * Next.js supports exactly ONE middleware export, so next-intl's middleware
 * cannot be exported alongside ours — it is invoked as a function inside this
 * handler. Order matters: locale resolves BEFORE the auth gate so that an
 * unauthenticated Hindi visitor is redirected to /hi/login rather than /login.
 *
 * Hard constraints (docs/ARCHITECTURE.md §4.2):
 *   - runs in the constrained edge environment, so NO database, NO Node APIs
 *   - NO Firebase Admin calls
 *   - the cookie SIGNATURE is verified here, but the claims inside it are only ever
 *     used for routing. Authorization is re-derived from the database in the service
 *     layer on every request, because these claims can be stale by design.
 */

const intlMiddleware = createIntlMiddleware(routing);

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const requestId = resolveRequestId(request.headers);

  // API routes must NOT go through locale handling — next-intl would rewrite
  // /api/v1/health to a locale-prefixed path and break it. They still get the
  // request id and security headers, and they authorize themselves rather than
  // being gated here (a JSON 401 is correct there, not a redirect).
  if (pathname.startsWith('/api')) {
    const apiResponse = NextResponse.next();
    decorate(apiResponse, { requestId, locale: routing.defaultLocale, pathname });
    return apiResponse;
  }

  /**
   * 1. Canonical route consolidation (docs/ROUTES.md §5).
   *
   * Before locale handling and before the auth gate, so a duplicate entry point costs one
   * cheap 308 and never renders anything. Done here rather than with `permanentRedirect()`
   * in a page because those segments stream: the 200 is committed before the page body
   * runs, and the redirect degrades to a client-side one.
   */
  const canonical = canonicalRedirectFor(pathname);
  if (canonical) {
    const prefix = pathname.slice(0, pathname.length - stripLocalePrefix(pathname).length);
    // 308, not 307: the method is preserved and crawlers and the PWA cache settle on the one
    // URL instead of keeping both alive forever.
    const redirect = NextResponse.redirect(
      new URL(`${prefix}${canonical}${search}`, request.url),
      308
    );
    decorate(redirect, { requestId, locale: detectLocaleFromPath(pathname), pathname });
    return redirect;
  }

  // 2. Locale resolution. next-intl may rewrite or redirect.
  const response = intlMiddleware(request);

  // next-intl signals its chosen locale via a rewrite header; fall back to the
  // URL prefix, then the default.
  const locale = detectLocale(pathname, response);

  // 3. Coarse auth gate.
  //
  // The cookie SIGNATURE is verified, not merely its presence. Checking presence
  // alone meant any visitor could reach a privileged shell by setting a cookie of
  // that name by hand.
  //
  // This remains routing, not authorization: the claims may be stale, so the page
  // itself re-derives permissions from the database (docs/SECURITY.md §4).
  if (requiresSession(pathname)) {
    const claims = await readSessionClaimsForRouting(
      request.cookies.get(SESSION_COOKIE_NAME)?.value,
      // Read here rather than through the validated config: middleware runs on the
      // edge, where a full Zod parse of the environment on every navigation is a cost
      // with no benefit.
      process.env.AUTH_SECRET
    );

    if (!claims) {
      const redirect = NextResponse.redirect(buildLoginUrl(request, locale, pathname, search));
      decorate(redirect, { requestId, locale, pathname });
      // A cookie that failed verification is expired, tampered with or signed by a
      // rotated key. Clearing it stops the browser resending a dead value and stops a
      // redirect loop where the gate keeps rejecting a cookie the browser keeps
      // presenting.
      if (request.cookies.has(SESSION_COOKIE_NAME)) {
        redirect.cookies.set({ name: SESSION_COOKIE_NAME, value: '', path: '/', maxAge: 0 });
      }
      return redirect;
    }

    // Wrong surface: a signed-in customer requesting /admin. Sent to their own home
    // rather than to sign-in, because they ARE signed in — bouncing them to a login
    // page they do not need is the confusing outcome.
    const requested = classifySurface(pathname);
    if (!surfacesForRoles(claims.roles).has(requested)) {
      const target = localePath(homePathForSurface(landingSurfaceForRoles(claims.roles)), locale);
      const redirect = NextResponse.redirect(new URL(target, request.url));
      decorate(redirect, { requestId, locale, pathname });
      return redirect;
    }
  }

  decorate(response, { requestId, locale, pathname });
  return response;
}

/** Login URL carrying a validated `next` so the user resumes where they were going. */
function buildLoginUrl(
  request: NextRequest,
  locale: string,
  pathname: string,
  search: string
): URL {
  const loginUrl = new URL(localePath('/login', locale), request.url);
  const target = `${stripLocalePrefix(pathname)}${search}`;

  if (isSafeRedirectTarget(target) && target !== '/login') {
    loginUrl.searchParams.set('next', target);
  }

  return loginUrl;
}

function decorate(
  response: NextResponse,
  meta: { requestId: string; locale: string; pathname: string }
): void {
  // Correlation: echoed to the client and forwarded to the app for logging.
  response.headers.set(REQUEST_ID_HEADER, meta.requestId);
  response.headers.set(LOCALE_HEADER, meta.locale);
  response.headers.set(PATHNAME_HEADER, meta.pathname);

  applySecurityHeaders(response.headers, {
    firebaseAuthDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    // Report-only until observed against real sign-in and checkout traffic.
    enforceCsp: false,
    noindex: isNoindexPath(meta.pathname) || !isIndexableDeployment(),
  });

  // Private surfaces must never be cached by a shared cache.
  //
  // `api` is excluded deliberately: the API layer owns its own cache policy.
  // `apiSuccess`/`apiError` already default every response to
  // `private, no-store`, so the safe default is preserved — but a genuinely public
  // endpoint (the category tree, product listings) must be able to opt into shared
  // caching, and a blanket override here silently defeated that.
  const surface = classifySurface(meta.pathname);
  if (surface !== 'public' && surface !== 'api') {
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  }
}

/**
 * Preview and staging are always noindex regardless of route
 * (docs/ROUTES.md §1). Read directly from process.env because middleware runs
 * in the edge environment where the validated server config is not loaded.
 */
function isIndexableDeployment(): boolean {
  return process.env.APP_ENV === 'production';
}

function detectLocale(pathname: string, response: NextResponse): string {
  const fromHeader = response.headers.get('x-next-intl-locale');
  if (fromHeader) return fromHeader;

  return detectLocaleFromPath(pathname);
}

/** Locale from the URL alone, for responses produced before next-intl has run. */
function detectLocaleFromPath(pathname: string): string {
  const segment = pathname.split('/')[1];
  if (segment && (routing.locales as readonly string[]).includes(segment)) {
    return segment;
  }

  return routing.defaultLocale;
}

/** Builds a locale-correct path; the default locale stays unprefixed (D-33a). */
function localePath(path: string, locale: string): string {
  return locale === routing.defaultLocale ? path : `/${locale}${path}`;
}

export const config = {
  /**
   * Skip Next internals and static assets. `_next`, files with an extension and
   * the service worker are excluded so middleware cost is only paid on real
   * navigations and API calls.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw.js|firebase-messaging-sw.js|.*\\.[\\w]+$).*)',
  ],
};
