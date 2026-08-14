/* eslint-disable */
/**
 * Parthik service worker — offline APP SHELL only (master spec §38).
 *
 * Scope, stated plainly:
 *   - Browsing the cached shell works offline.
 *   - Checkout, payment and any authenticated mutation DO NOT work offline, and
 *     this worker must never pretend otherwise (§38: "Do not pretend
 *     checkout/payment works offline").
 *
 * Strategy:
 *   - Navigations: network first, falling back to the cached /offline page. The
 *     network is always tried first so a user never sees stale prices.
 *   - Static assets: stale-while-revalidate, since they are content-hashed.
 *   - Everything private or dynamic: never cached at all.
 */

const VERSION = 'v1';
const SHELL_CACHE = `parthik-shell-${VERSION}`;
const ASSET_CACHE = `parthik-assets-${VERSION}`;
const OFFLINE_URL = '/offline';

/**
 * Never cached. Caching any of these would risk serving one user's data to
 * another, or showing a stale cart or price.
 */
const NEVER_CACHE_PATTERNS = [
  /^\/api\//,
  /^\/(hi\/)?account/,
  /^\/(hi\/)?checkout/,
  /^\/(hi\/)?orders/,
  /^\/(hi\/)?cart/,
  /^\/(hi\/)?favorites/,
  /^\/(hi\/)?login/,
  /^\/(hi\/)?vendor/,
  /^\/(hi\/)?driver/,
  /^\/(hi\/)?admin/,
];

function isNeverCached(pathname) {
  return NEVER_CACHE_PATTERNS.some((pattern) => pattern.test(pathname));
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/icons/') ||
    /\.(?:css|js|woff2?|png|jpe?g|svg|webp|ico)$/.test(pathname)
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Both locales, so an offline Hindi user gets a Hindi fallback.
      await cache.addAll([OFFLINE_URL, `/hi${OFFLINE_URL}`]).catch(() => undefined);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions so a deploy cannot leave a user on a
      // mix of old and new assets.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('parthik-') && !key.endsWith(VERSION))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCached(url.pathname)) return;

  // ---- Navigations: network first, offline page as fallback ----
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const wantsHindi = url.pathname === '/hi' || url.pathname.startsWith('/hi/');
          const fallback =
            (wantsHindi ? await cache.match(`/hi${OFFLINE_URL}`) : undefined) ??
            (await cache.match(OFFLINE_URL));

          return (
            fallback ??
            new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
          );
        }
      })()
    );
    return;
  }

  // ---- Static assets: stale-while-revalidate ----
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(request);

        const revalidate = fetch(request)
          .then((response) => {
            if (response.ok) void cache.put(request, response.clone());
            return response;
          })
          .catch(() => undefined);

        return cached ?? (await revalidate) ?? Response.error();
      })()
    );
  }
});
