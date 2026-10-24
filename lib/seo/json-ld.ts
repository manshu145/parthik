import { localeTags, type Locale } from '@/i18n/routing';
import { canonicalUrl, siteUrl } from './metadata';

/**
 * Structured data (docs/ROUTES.md §11).
 *
 * ⚠️ THE RULE THAT MATTERS: `Product` availability and price must reflect REAL,
 * current values — never a stale cached figure. Advertising in-stock items we cannot
 * sell is both an SEO penalty and a broken promise to a customer who clicked
 * through. Callers therefore pass live availability, not the ISR payload.
 *
 * These builders return plain objects. Rendering happens in the `JsonLd`
 * component so escaping is handled in exactly one place.
 */

/**
 * Structured-data URLs come from the SAME builder as canonicals.
 *
 * They previously had their own copy of the base-URL logic reading a different
 * environment variable, which meant JSON-LD could advertise one origin while the
 * canonical tag advertised another — a contradiction a crawler resolves by trusting
 * neither.
 */
function siteBase(): string {
  return siteUrl();
}

export interface BreadcrumbEntry {
  name: string;
  /** Locale-prefixed absolute URL. Omitted for the current page. */
  url?: string;
}

export function breadcrumbJsonLd(entries: BreadcrumbEntry[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: entries.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      ...(entry.url ? { item: entry.url } : {}),
    })),
  };
}

export function collectionPageJsonLd(input: {
  name: string;
  description: string | null;
  url: string;
  locale: Locale;
  itemCount: number;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    url: input.url,
    inLanguage: localeTags[input.locale],
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: input.itemCount,
    },
  };
}

export function productJsonLd(input: {
  name: string;
  description: string | null;
  url: string;
  locale: Locale;
  sku: string | null;
  brandName: string | null;
  pricePaise: number;
  /** MUST come from a live availability read, not from cached page data. */
  inStock: boolean;
  ratingAvg: string | null;
  ratingCount: number;
  imageUrl: string | null;
}): Record<string, unknown> {
  const priceRupees = (input.pricePaise / 100).toFixed(2);

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.sku ? { sku: input.sku } : {}),
    ...(input.brandName ? { brand: { '@type': 'Brand', name: input.brandName } } : {}),
    ...(input.imageUrl ? { image: [input.imageUrl] } : {}),
    inLanguage: localeTags[input.locale],
    url: input.url,
    offers: {
      '@type': 'Offer',
      url: input.url,
      priceCurrency: 'INR',
      // schema.org expects a decimal major-unit price, so paise are converted here
      // rather than anywhere near business logic.
      price: priceRupees,
      availability: input.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
    // Only emitted when real ratings exist. An AggregateRating with zero reviews is
    // invalid structured data and risks a manual action.
    ...(input.ratingCount > 0 && input.ratingAvg
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: input.ratingAvg,
            reviewCount: input.ratingCount,
          },
        }
      : {}),
  };
}

/**
 * The stable `@id` for the organisation node.
 *
 * A fragment identifier rather than a bare URL, so `Organization`, `WebSite` and
 * `LocalBusiness` can all reference the SAME entity instead of declaring three
 * unrelated ones — which is what makes a knowledge-panel association possible at
 * all.
 */
export function organizationId(): string {
  return `${siteBase()}/#organization`;
}

export function websiteId(): string {
  return `${siteBase()}/#website`;
}

/**
 * `Organization` for the home page.
 *
 * Deliberately minimal. `sameAs` (social profiles), `logo` and `contactPoint` are
 * omitted because no approved social accounts, brand asset (D-07a) or published
 * support number exist. Structured data asserting a logo URL that 404s, or a phone
 * number nobody answers, is worse than structured data that stays quiet.
 */
export function organizationJsonLd(input: {
  name: string;
  description: string;
  locale: Locale;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': organizationId(),
    name: input.name,
    description: input.description,
    url: `${siteBase()}/`,
    inLanguage: localeTags[input.locale],
  };
}

/**
 * `WebSite` with a `SearchAction`, which is what enables a sitelinks search box.
 *
 * The target MUST match the real search route and parameter or the feature silently
 * does nothing — `/search?q=` is the route the app actually serves.
 */
export function websiteJsonLd(input: { name: string; locale: Locale }): Record<string, unknown> {
  // Same builder the canonical tag uses, so the two can never disagree.
  const searchUrl = canonicalUrl('/search', input.locale);

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': websiteId(),
    name: input.name,
    url: canonicalUrl('/', input.locale),
    inLanguage: localeTags[input.locale],
    publisher: { '@id': organizationId() },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${searchUrl}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * `LocalBusiness` for a serviceable city.
 *
 * Emitted ONLY when real address and geo values are available. A hyperlocal service
 * that publishes a `LocalBusiness` with no verifiable address invites a manual
 * action, and inventing coordinates to satisfy the schema would be worse than
 * omitting the node — so the caller passes real store data or nothing.
 *
 * `areaServed` uses the delivery city rather than a radius, because the zone radius
 * is admin-configurable and would go stale in cached structured data.
 */
export function localBusinessJsonLd(input: {
  name: string;
  locale: Locale;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: string | null;
  longitude: string | null;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: input.name,
    parentOrganization: { '@id': organizationId() },
    url: `${siteBase()}/`,
    inLanguage: localeTags[input.locale],
    priceRange: '₹₹',
    address: {
      '@type': 'PostalAddress',
      streetAddress: input.streetAddress,
      addressLocality: input.city,
      addressRegion: input.state,
      postalCode: input.postalCode,
      addressCountry: 'IN',
    },
    ...(input.latitude && input.longitude
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: input.latitude,
            longitude: input.longitude,
          },
        }
      : {}),
    areaServed: { '@type': 'City', name: input.city },
  };
}
