import { describe, expect, it } from 'vitest';
import {
  parseZoneCookie,
  serializeZoneCookie,
  type ZoneCookiePayload,
} from '@/lib/http/zone-cookie';

/**
 * Location cookie tests.
 *
 * The cookie is deliberately NOT httpOnly, so it is client-writable and must be
 * treated as hostile input. Every malformed shape has to degrade to "no location
 * chosen" rather than throw during server rendering, where a throw would take out
 * the whole page.
 */

const VALID: ZoneCookiePayload = {
  pincode: '452001',
  zoneId: '00000000-0000-4000-8000-zone00000001',
  city: 'Indore',
  label: 'Indore',
  isServiceable: true,
};

describe('zone cookie round trip', () => {
  it('survives serialisation unchanged', () => {
    expect(parseZoneCookie(serializeZoneCookie(VALID))).toEqual(VALID);
  });

  it('preserves an unserviceable selection', () => {
    // A customer's choice of an unserviceable pincode must persist, so the UI keeps
    // explaining why ordering is unavailable instead of silently forgetting.
    const payload: ZoneCookiePayload = {
      pincode: '110001',
      zoneId: null,
      city: null,
      label: '110001',
      isServiceable: false,
    };

    expect(parseZoneCookie(serializeZoneCookie(payload))).toEqual(payload);
  });
});

describe('zone cookie rejects malformed input', () => {
  it('returns null for an absent cookie', () => {
    expect(parseZoneCookie(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseZoneCookie('')).toBeNull();
  });

  it('returns null for non-JSON', () => {
    expect(parseZoneCookie('not-json-at-all')).toBeNull();
  });

  it('returns null for a JSON array', () => {
    expect(parseZoneCookie('[1,2,3]')).toBeNull();
  });

  it('returns null for JSON null', () => {
    expect(parseZoneCookie('null')).toBeNull();
  });

  it('returns null for a missing pincode', () => {
    expect(parseZoneCookie(JSON.stringify({ label: 'Indore', isServiceable: true }))).toBeNull();
  });

  it('returns null for a malformed pincode', () => {
    for (const pincode of ['45200', '4520011', 'abcdef', '052001', '']) {
      expect(parseZoneCookie(JSON.stringify({ ...VALID, pincode }))).toBeNull();
    }
  });

  it('returns null when isServiceable is not a boolean', () => {
    // A string "false" is truthy in JavaScript, so a loose check here would flip an
    // unserviceable location into a serviceable one.
    expect(parseZoneCookie(JSON.stringify({ ...VALID, isServiceable: 'false' }))).toBeNull();
  });

  it('returns null for an over-long label', () => {
    // Bounded so a hostile cookie cannot push unbounded text into the header.
    expect(parseZoneCookie(JSON.stringify({ ...VALID, label: 'x'.repeat(200) }))).toBeNull();
  });

  it('coerces a non-string zoneId to null rather than trusting it', () => {
    const parsed = parseZoneCookie(JSON.stringify({ ...VALID, zoneId: 12345 }));

    expect(parsed).not.toBeNull();
    expect(parsed!.zoneId).toBeNull();
  });

  it('coerces a non-string city to null', () => {
    const parsed = parseZoneCookie(JSON.stringify({ ...VALID, city: { name: 'Indore' } }));

    expect(parsed!.city).toBeNull();
  });

  it('ignores unexpected extra fields', () => {
    const parsed = parseZoneCookie(JSON.stringify({ ...VALID, isAdmin: true, discount: 100 }));

    expect(parsed).toEqual(VALID);
    expect(parsed).not.toHaveProperty('isAdmin');
  });
});
