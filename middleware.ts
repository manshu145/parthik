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
  classifySurface,
  isNoindexPath,
  isSafeRedirectTarget,
  requiresSession,
  stripLocalePrefix,
} from '@/lib/http/route-access';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session-cookie';

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
 *   - session cookie presence is checked, never trusted for authorization
 */

const intlMiddleware = createIntlMiddleware(routing);

export function middleware(request: NextRequest): NextResponse {
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

  // 1. Locale resolution. next-intl may rewrite or redirect.
  const response = intlMiddleware(request);

  // next-intl signals its chosen locale via a rewrite header; fall back to the
  // URL prefix, then the default.
  const locale = detectLocale(pathname, response);

  // 2. Coarse auth gate — presence only, never a permission decision.
  if (requiresSession(pathname)) {
    const hasSession = request.cookies.has(SESSION_COOKIE_NAME);

    if (!hasSession) {
      const loginUrl = new URL(localePath('/login', locale), request.url);
      const target = `${stripLocalePrefix(pathname)}${search}`;
      if (isSafeRedirectTarget(target) && target !== '/login') {
        loginUrl.searchParams.set('next', target);
      }

      const redirect = NextResponse.redirect(loginUrl);
      decorate(redirect, { requestId, locale, pathname });
      return redirect;
    }
  }

  decorate(response, { requestId, locale, pathname });
  return response;
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
  if (classifySurface(meta.pathname) !== 'public') {
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
