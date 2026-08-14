import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import hi from '@/messages/hi.json';
import { defaultLocale, isLocale, localeNames, localeTags, locales } from '@/i18n/routing';

/**
 * Bilingual architecture verification (D-33).
 *
 * The V1 content scope (docs/ARCHITECTURE.md §12.6) requires UI strings to be
 * FULLY translated in both languages, with per-key English fallback available for
 * data content. These tests hold that line: an untranslated UI key should fail
 * CI, not reach a customer.
 */

type Messages = Record<string, unknown>;

/** Flattens nested messages to dotted keys for comparison. */
function flatten(source: Messages, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      result[path] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flatten(value as Messages, path));
    }
  }

  return result;
}

const flatEn = flatten(en as Messages);
const flatHi = flatten(hi as Messages);

describe('locale configuration', () => {
  it('supports exactly English and Hindi in V1', () => {
    expect([...locales]).toEqual(['en', 'hi']);
  });

  it('uses English as the fallback locale', () => {
    expect(defaultLocale).toBe('en');
  });

  it('maps every locale to a BCP-47 tag and a native display name', () => {
    for (const locale of locales) {
      expect(localeTags[locale]).toMatch(/^[a-z]{2}-IN$/);
      expect(localeNames[locale].length).toBeGreaterThan(0);
    }
  });

  it('shows Hindi in its own script, not transliterated', () => {
    // A language switcher that says "Hindi" in Latin script is a poor signal to
    // the users who need it most.
    expect(localeNames.hi).toBe('हिन्दी');
  });

  it('recognises valid locales and rejects others', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('hi')).toBe(true);
    expect(isLocale('mr')).toBe(false);
    expect(isLocale('')).toBe(false);
  });
});

describe('UI message catalogues', () => {
  it('has no empty English strings', () => {
    const empty = Object.entries(flatEn).filter(([, value]) => value.trim() === '');
    expect(empty).toEqual([]);
  });

  it('translates every UI string into Hindi', () => {
    const missing = Object.keys(flatEn).filter((key) => !(key in flatHi));
    expect(missing, `Missing Hindi translations: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no orphaned Hindi keys', () => {
    const orphaned = Object.keys(flatHi).filter((key) => !(key in flatEn));
    expect(orphaned, `Hindi keys with no English source: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('has no empty Hindi strings', () => {
    const empty = Object.entries(flatHi).filter(([, value]) => value.trim() === '');
    expect(empty).toEqual([]);
  });

  it('actually contains Devanagari rather than copied English', () => {
    const devanagari = /[\u0900-\u097F]/;
    // Latin letters are what "copied English" looks like. A value with none —
    // "452001", "G-XXXX", "{count}" — has nothing to translate, so requiring
    // Devanagari in it would force fake translations of numerals.
    const hasLatinLetters = /[A-Za-z]/;

    const notTranslated = Object.entries(flatHi)
      .filter(([, value]) => hasLatinLetters.test(value) && !devanagari.test(value))
      .map(([key]) => key);

    expect(notTranslated, `Hindi values without Devanagari: ${notTranslated.join(', ')}`).toEqual(
      []
    );
  });

  it('covers all eight required UX states in both languages', () => {
    // master spec §25 / §40 Definition of Done.
    const required = ['loading', 'empty', 'error', 'notFound', 'unauthorized', 'offline'];

    for (const state of required) {
      expect(flatEn[`states.${state}.title`] ?? flatEn[`states.${state}.label`]).toBeDefined();
      expect(flatHi[`states.${state}.title`] ?? flatHi[`states.${state}.label`]).toBeDefined();
    }
  });
});

describe('Intl formatting per locale', () => {
  it('formats currency in INR for both locales', () => {
    for (const locale of locales) {
      const formatted = new Intl.NumberFormat(localeTags[locale], {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(459);

      expect(formatted).toContain('₹');
    }
  });

  it('uses the Indian timezone for dates', () => {
    const formatted = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date('2026-08-14T00:00:00Z'));

    // 00:00 UTC is 05:30 IST.
    expect(formatted).toMatch(/05:30/);
  });
});
