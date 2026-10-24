import { beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/config/env';
import {
  breadcrumbJsonLd,
  collectionPageJsonLd,
  localBusinessJsonLd,
  organizationId,
  organizationJsonLd,
  productJsonLd,
  websiteId,
  websiteJsonLd,
} from '@/lib/seo/json-ld';

/**
 * Structured data (docs/ROUTES.md §11, master spec §20).
 *
 * Structured data fails SILENTLY. An invalid node is ignored by crawlers with nothing
 * on screen to show for it, and an node that asserts something untrue — stock we do
 * not have, a rating with no reviews — risks a manual action. So the tests here are
 * mostly about what must NOT be emitted.
 */

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://parthik.com';
  resetEnvCacheForTests();
});

describe('organization', () => {
  it('uses a stable @id so other nodes can reference the same entity', () => {
    const node = organizationJsonLd({ name: 'Parthik', description: 'Groceries', locale: 'en' });

    expect(node['@id']).toBe('https://parthik.com/#organization');
    expect(organizationId()).toBe(node['@id']);
  });

  it('omits logo, sameAs and contactPoint while none exist', () => {
    // Asserting a logo URL that 404s or a phone nobody answers is worse than silence.
    const node = organizationJsonLd({ name: 'Parthik', description: 'Groceries', locale: 'en' });

    expect(node).not.toHaveProperty('logo');
    expect(node).not.toHaveProperty('sameAs');
    expect(node).not.toHaveProperty('contactPoint');
  });

  it('declares the content language', () => {
    expect(organizationJsonLd({ name: 'P', description: 'd', locale: 'hi' }).inLanguage).toBe(
      'hi-IN'
    );
  });
});

describe('website', () => {
  it('points the search action at the real route and parameter', () => {
    // A SearchAction whose target does not match the app silently does nothing.
    const node = websiteJsonLd({ name: 'Parthik', locale: 'en' });
    const action = node.potentialAction as {
      target: { urlTemplate: string };
      'query-input': string;
    };

    expect(action.target.urlTemplate).toBe('https://parthik.com/search?q={search_term_string}');
    expect(action['query-input']).toBe('required name=search_term_string');
  });

  it('locale-prefixes the search target for Hindi', () => {
    const node = websiteJsonLd({ name: 'Parthik', locale: 'hi' });
    const action = node.potentialAction as { target: { urlTemplate: string } };

    expect(action.target.urlTemplate).toBe('https://parthik.com/hi/search?q={search_term_string}');
    expect(node.url).toBe('https://parthik.com/hi');
  });

  it('links the site to the organization rather than restating it', () => {
    const node = websiteJsonLd({ name: 'Parthik', locale: 'en' });

    expect(node['@id']).toBe(websiteId());
    expect(node.publisher).toEqual({ '@id': organizationId() });
  });
});

describe('product', () => {
  const base = {
    name: 'Atta',
    description: 'Whole wheat',
    url: 'https://parthik.com/products/atta',
    locale: 'en' as const,
    sku: null,
    brandName: null,
    pricePaise: 28_900,
    inStock: true,
    ratingAvg: null,
    ratingCount: 0,
    imageUrl: null,
  };

  it('converts paise to a decimal major-unit price', () => {
    const offers = productJsonLd(base).offers as { price: string; priceCurrency: string };

    expect(offers.price).toBe('289.00');
    expect(offers.priceCurrency).toBe('INR');
  });

  it('reports out-of-stock accurately', () => {
    // Advertising availability we cannot honour is a broken promise to whoever
    // clicks through, not just an SEO penalty.
    const offers = productJsonLd({ ...base, inStock: false }).offers as { availability: string };

    expect(offers.availability).toBe('https://schema.org/OutOfStock');
  });

  it('omits aggregateRating when there are no reviews', () => {
    // A rating with zero reviews is invalid structured data.
    expect(productJsonLd(base)).not.toHaveProperty('aggregateRating');
  });

  it('emits aggregateRating only with a real average and count', () => {
    const node = productJsonLd({ ...base, ratingAvg: '4.5', ratingCount: 12 });

    expect(node.aggregateRating).toMatchObject({ ratingValue: '4.5', reviewCount: 12 });
  });

  it('omits a rating when the count is positive but the average is missing', () => {
    expect(productJsonLd({ ...base, ratingAvg: null, ratingCount: 12 })).not.toHaveProperty(
      'aggregateRating'
    );
  });

  it('omits optional fields rather than emitting nulls', () => {
    const node = productJsonLd(base);

    for (const key of ['sku', 'brand', 'image']) {
      expect(node, `${key} should be absent, not null`).not.toHaveProperty(key);
    }
  });
});

describe('local business', () => {
  const address = {
    name: 'Demo Kirana — Central',
    locale: 'en' as const,
    streetAddress: '12 Demo Market Road',
    city: 'Indore',
    state: 'Madhya Pradesh',
    postalCode: '452001',
    latitude: '22.719568',
    longitude: '75.857727',
  };

  it('emits a full postal address with the country', () => {
    const node = localBusinessJsonLd(address);

    expect(node.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: '12 Demo Market Road',
      addressLocality: 'Indore',
      addressRegion: 'Madhya Pradesh',
      postalCode: '452001',
      addressCountry: 'IN',
    });
  });

  it('omits geo coordinates when they are unknown', () => {
    // Inventing coordinates to satisfy the schema would be worse than omitting them.
    const node = localBusinessJsonLd({ ...address, latitude: null, longitude: null });

    expect(node).not.toHaveProperty('geo');
  });

  it('requires both coordinates before emitting geo', () => {
    expect(localBusinessJsonLd({ ...address, longitude: null })).not.toHaveProperty('geo');
    expect(localBusinessJsonLd({ ...address, latitude: null })).not.toHaveProperty('geo');
  });

  it('attaches the business to the organization', () => {
    expect(localBusinessJsonLd(address).parentOrganization).toEqual({ '@id': organizationId() });
  });

  it('describes the area served by city, not by radius', () => {
    // A zone radius is admin-configurable and would go stale inside cached markup.
    expect(localBusinessJsonLd(address).areaServed).toEqual({ '@type': 'City', name: 'Indore' });
  });
});

describe('breadcrumbs', () => {
  it('numbers positions from one and omits the item for the current page', () => {
    const node = breadcrumbJsonLd([
      { name: 'Home', url: 'https://parthik.com/' },
      { name: 'Offers' },
    ]);
    const items = node.itemListElement as Array<Record<string, unknown>>;

    expect(items[0]).toMatchObject({ position: 1, item: 'https://parthik.com/' });
    expect(items[1]).toMatchObject({ position: 2, name: 'Offers' });
    // The current page is where the visitor already is; linking to it adds nothing.
    expect(items[1]).not.toHaveProperty('item');
  });
});

describe('collection page', () => {
  it('reports the real item count', () => {
    const node = collectionPageJsonLd({
      name: 'Staples',
      description: null,
      url: 'https://parthik.com/category/staples',
      locale: 'en',
      itemCount: 7,
    });

    expect(node.mainEntity).toEqual({ '@type': 'ItemList', numberOfItems: 7 });
    expect(node).not.toHaveProperty('description');
  });
});

describe('every node is valid JSON-LD', () => {
  it('declares @context and @type and survives serialisation', () => {
    const nodes = [
      organizationJsonLd({ name: 'P', description: 'd', locale: 'en' }),
      websiteJsonLd({ name: 'P', locale: 'en' }),
      breadcrumbJsonLd([{ name: 'Home' }]),
      collectionPageJsonLd({
        name: 'C',
        description: null,
        url: 'https://parthik.com/c',
        locale: 'en',
        itemCount: 0,
      }),
    ];

    for (const node of nodes) {
      expect(node['@context']).toBe('https://schema.org');
      expect(typeof node['@type']).toBe('string');
      // Anything non-serialisable would throw when the JsonLd component renders it.
      expect(() => JSON.stringify(node)).not.toThrow();
    }
  });
});
