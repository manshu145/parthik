import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { defaultLocale, localeTags, routing, type Locale } from './routing';

/**
 * Per-request i18n configuration.
 *
 * Fallback rule (docs/ARCHITECTURE.md §12.6): a missing Hindi message falls back
 * to English per key. Nothing may render as an empty string or a raw message
 * key — that is the failure mode users actually notice.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = hasLocale(routing.locales, requested) ? requested : defaultLocale;

  const [messages, fallbackMessages] = await Promise.all([
    loadMessages(locale),
    locale === defaultLocale ? Promise.resolve(null) : loadMessages(defaultLocale),
  ]);

  return {
    locale,
    // English is merged underneath so any key absent from Hindi resolves to the
    // English string rather than disappearing.
    messages: fallbackMessages ? deepMerge(fallbackMessages, messages) : messages,
    timeZone: 'Asia/Kolkata',
    formats: {
      number: {
        currency: { style: 'currency', currency: 'INR', maximumFractionDigits: 0 },
      },
      dateTime: {
        short: { day: 'numeric', month: 'short', year: 'numeric' },
      },
    },
    onError(error) {
      // A missing message is a content gap, not a crash. It is surfaced in dev
      // and swallowed in production after falling back.
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[i18n] ${error.message}`);
      }
    },
    getMessageFallback({ key }) {
      // Last resort: show the final path segment rather than a raw dotted key.
      const readable = key.split('.').pop() ?? key;
      return readable.replace(/([A-Z])/g, ' $1').toLowerCase();
    },
  };
});

type Messages = Record<string, unknown>;

async function loadMessages(locale: Locale): Promise<Messages> {
  const imported = (await import(`../messages/${locale}.json`)) as { default: Messages };
  return imported.default;
}

/** Merges `override` over `base`, recursing into plain objects only. */
function deepMerge(base: Messages, override: Messages): Messages {
  const result: Messages = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMerge(existing, value);
    } else if (value !== undefined && value !== '') {
      result[key] = value;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Messages {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export { localeTags };
