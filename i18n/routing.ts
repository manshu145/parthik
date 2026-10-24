import { defineRouting } from 'next-intl/routing';

/**
 * Locale routing (decision D-33, docs/ROUTES.md §2.1).
 *
 * URL strategy is `as-needed` (D-33a): English is unprefixed and Hindi is
 * prefixed.
 *
 *   /products/atta-5kg      -> English
 *   /hi/products/atta-5kg   -> Hindi
 *
 * English stays unprefixed so existing/legacy URL shapes keep their SEO equity,
 * which matters for the D-31 migration and the redirects table.
 *
 * Adding a further Indian language means adding it here and to messages/ — no
 * structural change, which is the requirement D-33 set.
 */
export const locales = ['en', 'hi'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/** BCP-47 tags used for Intl formatting and the html lang attribute. */
export const localeTags: Record<Locale, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
};

export const localeNames: Record<Locale, string> = {
  en: 'English',
  hi: 'हिन्दी',
};

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'as-needed',
  // Persist the choice so a returning visitor keeps their language.
  localeDetection: true,
  localeCookie: {
    name: 'PARTHIK_LOCALE',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  },
});

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
