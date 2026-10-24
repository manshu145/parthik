import { describe, expect, it } from 'vitest';
import {
  categorySlugParamSchema,
  productListQuerySchema,
  productSortSchema,
  relatedProductsQuerySchema,
  slugSchema,
} from '@/modules/catalog/catalog.schema';
import { decodeCursor, encodeCursor } from '@/lib/db/cursor';

describe('slugSchema', () => {
  it('accepts a normal slug', () => {
    expect(slugSchema.parse('demo-atta-5kg')).toBe('demo-atta-5kg');
  });

  it('rejects uppercase rather than normalising it', () => {
    // Two casings would be two cache keys for one piece of content.
    expect(slugSchema.safeParse('Demo-Atta').success).toBe(false);
  });

  it('rejects path traversal and separators', () => {
    for (const value of ['../etc/passwd', 'a/b', 'a.b', 'a_b', 'a b']) {
      expect(slugSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects leading, trailing and doubled hyphens', () => {
    for (const value of ['-atta', 'atta-', 'a--b']) {
      expect(slugSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects an over-long slug', () => {
    expect(slugSchema.safeParse('a'.repeat(200)).success).toBe(false);
  });

  it('rejects an empty slug', () => {
    expect(slugSchema.safeParse('').success).toBe(false);
  });
});

describe('productSortSchema', () => {
  it('accepts allowlisted keys with and without a direction', () => {
    for (const value of [
      'createdAt',
      'createdAt:desc',
      'pricePaise:asc',
      'ratingAvg:desc',
      'soldCount:desc',
    ]) {
      expect(productSortSchema.safeParse(value).success).toBe(true);
    }
  });

  it('REJECTS an arbitrary column name', () => {
    // Sorting must never accept a raw column — that is an injection surface and
    // leaks schema detail.
    for (const value of ['costPaise:desc', 'created_at', 'id', 'vendor_id:asc']) {
      expect(productSortSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects an invalid direction', () => {
    expect(productSortSchema.safeParse('pricePaise:sideways').success).toBe(false);
  });
});

describe('productListQuerySchema', () => {
  it('coerces numeric strings from the query string', () => {
    const parsed = productListQuerySchema.parse({
      minPricePaise: '5000',
      maxPricePaise: '20000',
      limit: '12',
    });

    expect(parsed.minPricePaise).toBe(5_000);
    expect(parsed.limit).toBe(12);
  });

  it('coerces inStock to a boolean', () => {
    expect(productListQuerySchema.parse({ inStock: 'true' }).inStock).toBe(true);
    expect(productListQuerySchema.parse({ inStock: 'false' }).inStock).toBe(false);
  });

  it('rejects a non-boolean inStock rather than treating it as true', () => {
    // "1" being truthy is exactly how a filter silently changes meaning.
    expect(productListQuerySchema.safeParse({ inStock: '1' }).success).toBe(false);
  });

  it('rejects fractional paise', () => {
    expect(productListQuerySchema.safeParse({ minPricePaise: '199.5' }).success).toBe(false);
  });

  it('rejects a negative price', () => {
    expect(productListQuerySchema.safeParse({ minPricePaise: '-100' }).success).toBe(false);
  });

  it('rejects a min above the max', () => {
    const result = productListQuerySchema.safeParse({
      minPricePaise: '20000',
      maxPricePaise: '5000',
    });

    expect(result.success).toBe(false);
  });

  it('accepts min equal to max', () => {
    expect(
      productListQuerySchema.safeParse({ minPricePaise: '5000', maxPricePaise: '5000' }).success
    ).toBe(true);
  });

  it('REJECTS unsuffixed price params', () => {
    // The suffix is the guard against a rupees/paise mix-up.
    expect(productListQuerySchema.safeParse({ minPrice: '100' }).success).toBe(false);
  });

  it('rejects unknown parameters', () => {
    expect(productListQuerySchema.safeParse({ vendorId: 'someone-else' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ status: 'DRAFT' }).success).toBe(false);
  });

  it('caps the limit at the shared maximum', () => {
    expect(productListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('requires a search term of at least 2 characters', () => {
    expect(productListQuerySchema.safeParse({ search: 'a' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ search: 'ab' }).success).toBe(true);
  });

  it('accepts an empty query', () => {
    expect(productListQuerySchema.parse({})).toEqual({});
  });

  it('accepts a category slug', () => {
    expect(productListQuerySchema.safeParse({ category: 'staples' }).success).toBe(true);
  });

  it('treats a uuid as a syntactically valid slug that simply will not resolve', () => {
    // A UUID happens to match the slug grammar, and tightening the regex to
    // exclude it would be arbitrary. The real protection is that the service
    // resolves slugs against the database and raises NotFound — covered in
    // catalog-service.test.ts — rather than silently listing everything.
    expect(
      productListQuerySchema.safeParse({ category: '11111111-2222-4333-8444-555555555555' }).success
    ).toBe(true);
  });
});

describe('categorySlugParamSchema', () => {
  it('rejects extra fields', () => {
    expect(categorySlugParamSchema.safeParse({ slug: 'staples', locale: 'en' }).success).toBe(
      false
    );
  });
});

describe('relatedProductsQuerySchema', () => {
  it('bounds the limit', () => {
    expect(relatedProductsQuerySchema.safeParse({ limit: '8' }).success).toBe(true);
    expect(relatedProductsQuerySchema.safeParse({ limit: '100' }).success).toBe(false);
    expect(relatedProductsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });
});

describe('cursor encoding', () => {
  it('round-trips a key, value and id', () => {
    const cursor = encodeCursor('createdAt', '2026-01-01T00:00:00.000Z', 'abc-123');

    expect(decodeCursor(cursor, 'createdAt')).toEqual({
      key: 'createdAt',
      value: '2026-01-01T00:00:00.000Z',
      id: 'abc-123',
    });
  });

  it('is opaque rather than readable', () => {
    const cursor = encodeCursor('pricePaise', '28900', 'abc-123');

    expect(cursor).not.toContain('pricePaise');
    expect(cursor).not.toContain('28900');
  });

  it('REFUSES a cursor issued for a different sort key', () => {
    // The whole point: a keyset comparison is only valid against its own column.
    const cursor = encodeCursor('createdAt', '2026-01-01T00:00:00.000Z', 'abc-123');

    expect(decodeCursor(cursor, 'pricePaise')).toBeNull();
  });

  it('returns null for a malformed cursor rather than throwing', () => {
    for (const value of ['', 'not-base64!!', Buffer.from('onlyonepart').toString('base64url')]) {
      expect(decodeCursor(value, 'createdAt')).toBeNull();
    }
  });

  it('survives values containing unusual characters', () => {
    const cursor = encodeCursor('ratingAvg', '4.50', 'id-with-dashes-123');
    expect(decodeCursor(cursor, 'ratingAvg')?.value).toBe('4.50');
  });
});
