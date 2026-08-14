import { locales } from '@/i18n/routing';

/**
 * Coarse route classification used by middleware (docs/ROUTES.md §10).
 *
 * This is deliberately NOT authorization. Middleware cannot reach the database
 * on Cloudflare Workers (Node middleware is unsupported by the OpenNext
 * adapter), so it can only make a cheap routing decision. Real authorization —
 * permissions, ownership, vendor/driver approval — happens in the service layer
 * on every request.
 *
 * In other words: a valid-looking cookie gets you to a page shell, never to
 * data.
 */

export type SurfaceKind = 'public' | 'customer' | 'vendor' | 'driver' | 'admin' | 'api' | 'system';

/** Prefixes that require an authenticated session, mapped to their surface. */
const PROTECTED_PREFIXES: ReadonlyArray<{ prefix: string; surface: SurfaceKind }> = [
  { prefix: '/account', surface: 'customer' },
  { prefix: '/checkout', surface: 'customer' },
  { prefix: '/orders', surface: 'customer' },
  { prefix: '/favorites', surface: 'customer' },
  { prefix: '/vendor', surface: 'vendor' },
  { prefix: '/driver', surface: 'driver' },
  { prefix: '/admin', surface: 'admin' },
];

/** Private surfaces are never indexable (docs/ROUTES.md §1). */
const NOINDEX_PREFIXES: readonly string[] = [
  '/account',
  '/checkout',
  '/orders',
  '/favorites',
  '/vendor',
  '/driver',
  '/admin',
  '/api',
  '/search',
  '/login',
];

/**
 * Strips a leading locale segment so route rules are written once rather than
 * per locale. `/hi/vendor/orders` and `/vendor/orders` classify identically.
 */
export function stripLocalePrefix(pathname: string): string {
  for (const locale of locales) {
    if (pathname === `/${locale}`) return '/';
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1);
    }
  }
  return pathname;
}

export function classifySurface(pathname: string): SurfaceKind {
  const path = stripLocalePrefix(pathname);

  if (path.startsWith('/api')) return 'api';

  const match = PROTECTED_PREFIXES.find(
    ({ prefix }) => path === prefix || path.startsWith(`${prefix}/`)
  );

  return match?.surface ?? 'public';
}

export function requiresSession(pathname: string): boolean {
  const surface = classifySurface(pathname);
  // API route handlers authorize themselves; middleware does not gate them,
  // because a 401 JSON response is correct there rather than a redirect.
  return surface !== 'public' && surface !== 'api' && surface !== 'system';
}

export function isNoindexPath(pathname: string): boolean {
  const path = stripLocalePrefix(pathname);
  return NOINDEX_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Where an authenticated actor lands when they hit the wrong surface. */
export function homePathForSurface(surface: SurfaceKind): string {
  switch (surface) {
    case 'vendor':
      return '/vendor';
    case 'driver':
      return '/driver';
    case 'admin':
      return '/admin';
    default:
      return '/';
  }
}

/**
 * Validates a `?next=` target. Only internal, single-slash paths are allowed so
 * the parameter cannot be used as an open redirect.
 */
export function isSafeRedirectTarget(target: string): boolean {
  return target.startsWith('/') && !target.startsWith('//') && !target.includes('\\');
}
