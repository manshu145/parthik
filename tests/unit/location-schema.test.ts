import { describe, expect, it } from 'vitest';
import {
  autocompleteQuerySchema,
  coordinatesSchema,
  pincodeSchema,
  placeDetailsQuerySchema,
  routeEstimateBodySchema,
  selectLocationBodySchema,
  serviceabilityQuerySchema,
  sessionTokenSchema,
} from '@/modules/location/location.schema';

/**
 * Location input validation tests.
 *
 * Validation must behave identically whether the mock or the real Google provider
 * is active — a missing credential never relaxes a rule
 * (.kiro/steering/provider-credentials.md). These tests exercise the schemas
 * directly, with no provider involved at all.
 */

describe('pincodeSchema', () => {
  it('accepts a valid Indian PIN code', () => {
    expect(pincodeSchema.parse('452001')).toBe('452001');
  });

  it('trims surrounding whitespace', () => {
    // Pasted values routinely carry whitespace; rejecting them would be hostile.
    expect(pincodeSchema.parse('  452001  ')).toBe('452001');
  });

  it('rejects a leading zero', () => {
    // No Indian PIN code begins with 0.
    expect(pincodeSchema.safeParse('052001').success).toBe(false);
  });

  it('rejects the wrong number of digits', () => {
    expect(pincodeSchema.safeParse('45200').success).toBe(false);
    expect(pincodeSchema.safeParse('4520011').success).toBe(false);
  });

  it('rejects non-digits', () => {
    expect(pincodeSchema.safeParse('4520A1').success).toBe(false);
    expect(pincodeSchema.safeParse('452 001').success).toBe(false);
  });
});

describe('coordinatesSchema', () => {
  it('accepts coordinates inside India', () => {
    expect(coordinatesSchema.parse({ latitude: 22.7196, longitude: 75.8577 })).toEqual({
      latitude: 22.7196,
      longitude: 75.8577,
    });
  });

  it('coerces numeric strings, as query parameters arrive', () => {
    expect(coordinatesSchema.parse({ latitude: '22.7196', longitude: '75.8577' })).toEqual({
      latitude: 22.7196,
      longitude: 75.8577,
    });
  });

  it('rejects coordinates outside India', () => {
    // Bounded to India's bounding box: a coordinate in the Atlantic is not a
    // serviceability question, and rejecting it avoids a pointless billable call.
    expect(coordinatesSchema.safeParse({ latitude: 51.5, longitude: -0.12 }).success).toBe(false);
    expect(coordinatesSchema.safeParse({ latitude: 0, longitude: 0 }).success).toBe(false);
  });

  it('rejects non-numeric values', () => {
    expect(coordinatesSchema.safeParse({ latitude: 'north', longitude: 'east' }).success).toBe(
      false
    );
  });

  it('rejects unexpected fields', () => {
    expect(
      coordinatesSchema.safeParse({ latitude: 22.7, longitude: 75.8, altitude: 500 }).success
    ).toBe(false);
  });
});

describe('sessionTokenSchema', () => {
  it('accepts a URL-safe token', () => {
    expect(sessionTokenSchema.parse('abc123-DEF_456')).toBe('abc123-DEF_456');
  });

  it('rejects an empty or too-short token', () => {
    expect(sessionTokenSchema.safeParse('').success).toBe(false);
    expect(sessionTokenSchema.safeParse('short').success).toBe(false);
  });

  it('rejects characters that are not URL safe', () => {
    expect(sessionTokenSchema.safeParse('abc/../../etc/passwd').success).toBe(false);
    expect(sessionTokenSchema.safeParse('token with spaces').success).toBe(false);
  });

  it('rejects an over-long token', () => {
    expect(sessionTokenSchema.safeParse('a'.repeat(200)).success).toBe(false);
  });
});

describe('serviceabilityQuerySchema', () => {
  it('accepts a pincode', () => {
    expect(serviceabilityQuerySchema.parse({ pincode: '452001' })).toEqual({ pincode: '452001' });
  });

  it('rejects extra parameters', () => {
    expect(
      serviceabilityQuerySchema.safeParse({ pincode: '452001', zoneId: 'injected' }).success
    ).toBe(false);
  });
});

describe('autocompleteQuerySchema', () => {
  it('accepts a query with a session token', () => {
    const parsed = autocompleteQuerySchema.parse({
      q: 'Palasia',
      sessionToken: 'session-token-value',
    });

    expect(parsed.q).toBe('Palasia');
  });

  it('requires at least three characters', () => {
    // Shorter queries return noise and still cost money.
    expect(
      autocompleteQuerySchema.safeParse({ q: 'MG', sessionToken: 'session-token-value' }).success
    ).toBe(false);
  });

  it('requires a session token', () => {
    // The cost control, enforced at the edge.
    expect(autocompleteQuerySchema.safeParse({ q: 'Palasia', sessionToken: '' }).success).toBe(
      false
    );
    expect(autocompleteQuerySchema.safeParse({ q: 'Palasia' }).success).toBe(false);
  });

  it('rejects an over-long query', () => {
    expect(
      autocompleteQuerySchema.safeParse({
        q: 'x'.repeat(500),
        sessionToken: 'session-token-value',
      }).success
    ).toBe(false);
  });

  it('accepts an optional origin for location biasing', () => {
    const parsed = autocompleteQuerySchema.parse({
      q: 'Palasia',
      sessionToken: 'session-token-value',
      originLat: '22.7196',
      originLng: '75.8577',
    });

    expect(parsed.originLat).toBe(22.7196);
  });

  it('rejects an origin outside India', () => {
    expect(
      autocompleteQuerySchema.safeParse({
        q: 'Palasia',
        sessionToken: 'session-token-value',
        originLat: '51.5',
        originLng: '-0.12',
      }).success
    ).toBe(false);
  });
});

describe('placeDetailsQuerySchema', () => {
  it('accepts a place id and session token', () => {
    expect(
      placeDetailsQuerySchema.safeParse({
        placeId: 'mock-place-palasia',
        sessionToken: 'session-token-value',
      }).success
    ).toBe(true);
  });

  it('rejects an empty place id', () => {
    expect(
      placeDetailsQuerySchema.safeParse({ placeId: '', sessionToken: 'session-token-value' })
        .success
    ).toBe(false);
  });
});

describe('routeEstimateBodySchema', () => {
  it('accepts an origin and destination', () => {
    expect(
      routeEstimateBodySchema.safeParse({
        origin: { latitude: 22.7196, longitude: 75.8577 },
        destination: { latitude: 22.7244, longitude: 75.8839 },
      }).success
    ).toBe(true);
  });

  it('rejects a missing destination', () => {
    expect(
      routeEstimateBodySchema.safeParse({ origin: { latitude: 22.7196, longitude: 75.8577 } })
        .success
    ).toBe(false);
  });
});

describe('selectLocationBodySchema', () => {
  it('accepts a pincode with an optional label', () => {
    expect(selectLocationBodySchema.parse({ pincode: '452001', label: 'Palasia' })).toEqual({
      pincode: '452001',
      label: 'Palasia',
    });
  });

  it('accepts a pincode alone', () => {
    expect(selectLocationBodySchema.parse({ pincode: '452001' })).toEqual({ pincode: '452001' });
  });

  it('REJECTS a client-supplied zoneId', () => {
    // The zone is resolved server-side from the pincode. Accepting a zone id would
    // let a client assert its own serviceability.
    expect(
      selectLocationBodySchema.safeParse({ pincode: '452001', zoneId: 'some-zone' }).success
    ).toBe(false);
  });

  it('REJECTS a client-supplied isServiceable flag', () => {
    expect(
      selectLocationBodySchema.safeParse({ pincode: '452001', isServiceable: true }).success
    ).toBe(false);
  });

  it('rejects an over-long label', () => {
    expect(
      selectLocationBodySchema.safeParse({ pincode: '452001', label: 'x'.repeat(200) }).success
    ).toBe(false);
  });
});
