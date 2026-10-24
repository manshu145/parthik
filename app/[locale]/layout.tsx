import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { defaultLocale, isLocale, localeTags, routing, type Locale } from '@/i18n/routing';
import { isIndexableEnvironment } from '@/lib/config/env';
import { alternatesFor, metadataBase, socialMetadata } from '@/lib/seo/metadata';
import '../globals.css';

/**
 * Locale layout. Owns <html> and <body> so `lang` reflects the resolved locale,
 * which matters for screen readers, hyphenation and Devanagari rendering.
 */

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});

/**
 * Pre-renders both locales at build time. `dynamicParams` stays default so an
 * unknown locale 404s rather than silently serving English at a bogus URL
 * (docs/ROUTES.md §2.1).
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  const resolved: Locale = isLocale(locale) ? locale : defaultLocale;

  return {
    // Resolves every relative URL in child metadata. Without it Next resolves them
    // against localhost in production and warns at build time.
    metadataBase: metadataBase(),
    title: {
      default: t('appName'),
      template: `%s · ${t('appName')}`,
    },
    description: t('tagline'),
    applicationName: t('appName'),
    // Preview and staging are never indexable (docs/ROUTES.md §1).
    robots: isIndexableEnvironment()
      ? { index: true, follow: true }
      : { index: false, follow: false },
    formatDetection: { telephone: false },
    // Home-page canonical and hreflang. Child pages override with their own path;
    // having it here means a page that forgets still emits a correct language map
    // rather than none at all.
    alternates: alternatesFor('/', resolved),
    ...socialMetadata({
      title: t('appName'),
      description: t('tagline'),
      path: '/',
      locale: resolved,
      siteName: t('appName'),
    }),
  };
}

export const viewport = {
  themeColor: '#1f7a52',
  width: 'device-width',
  initialScale: 1,
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Required for static rendering of localised pages.
  setRequestLocale(locale);

  return (
    <html lang={localeTags[locale as Locale]} suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
