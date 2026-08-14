import { getClientEnv } from '@/lib/config/env';
import { defaultLocale, localeTags, type Locale } from '@/i18n/routing';

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

export function absoluteUrl(path: string, locale: Locale): string {
  const base = getClientEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  const prefix = locale === defaultLocale ? '' : `/${locale}`;
  const suffix = path.startsWith('/') ? path : `/${path}`;

  return `${base}${prefix}${suffix}`;
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
