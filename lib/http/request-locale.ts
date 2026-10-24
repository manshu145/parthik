import { defaultLocale, isLocale, locales, type Locale } from '@/i18n/routing';

/**
 * Resolves the locale for an API request (docs/API_SPEC.md §1.2).
 *
 * Precedence:
 *   1. `?locale=` — explicit, so a caller can always be unambiguous.
 *   2. `Accept-Language` — the browser's preference, quality-ordered.
 *   3. English.
 *
 * An UNSUPPORTED value falls back rather than 404s. That differs deliberately from
 * page routing, where `/xx/products` must 404: a bad path is a broken link worth
 * surfacing, whereas `Accept-Language: de` is just a German-speaking visitor whose
 * request should still be answered.
 */
export function resolveRequestLocale(request: Request): Locale {
  const url = new URL(request.url);

  const explicit = url.searchParams.get('locale');
  if (explicit && isLocale(explicit)) return explicit;

  return parseAcceptLanguage(request.headers.get('accept-language')) ?? defaultLocale;
}

/**
 * Picks the best supported locale from an `Accept-Language` header.
 *
 * Handles quality weights and region subtags (`hi-IN` matches `hi`), because real
 * browsers send both and a naive exact match would silently ignore every regional
 * variant.
 */
export function parseAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const quality = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='))
        ?.slice(2);

      const parsed = quality === undefined ? 1 : Number.parseFloat(quality);

      return {
        tag: (tag ?? '').trim().toLowerCase(),
        // A malformed q value is treated as lowest priority rather than NaN, which
        // would poison the sort.
        quality: Number.isFinite(parsed) ? parsed : 0,
      };
    })
    .filter((entry) => entry.tag.length > 0 && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const entry of ranked) {
    if (entry.tag === '*') return defaultLocale;

    const base = entry.tag.split('-')[0] ?? '';
    const match = locales.find((locale) => locale === entry.tag || locale === base);
    if (match) return match;
  }

  return null;
}

/**
 * Headers for a PUBLIC, cacheable catalog response.
 *
 * `apiSuccess` defaults to `private, no-store`, which is right for authenticated
 * data and wrong for a public category tree. These are applied explicitly per route
 * so caching is always a deliberate choice rather than an inherited default.
 *
 * `Vary: Accept-Language` is not optional: without it a shared cache will serve the
 * Hindi payload to the next English visitor on the same URL.
 */
export function publicCacheHeaders(locale: Locale, maxAgeSeconds = 300): Record<string, string> {
  return {
    'Cache-Control': `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 2}`,
    'Content-Language': locale,
    Vary: 'Accept-Language',
  };
}

/** Headers for data that must never be cached, such as live stock. */
export function noStoreHeaders(locale: Locale): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'Content-Language': locale,
    Vary: 'Accept-Language',
  };
}
