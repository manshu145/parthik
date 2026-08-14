import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import hi from '@/messages/hi.json';
import type { Locale } from '@/i18n/routing';

/**
 * Renders a component inside the i18n provider.
 *
 * Component tests run against the REAL message catalogues rather than stubs, so a
 * missing or malformed translation fails the test — which is the point, given the
 * whole UI must work in English and Hindi.
 */

const MESSAGES: Record<Locale, Record<string, unknown>> = {
  en: en as Record<string, unknown>,
  hi: hi as Record<string, unknown>,
};

export function renderWithIntl(
  ui: ReactElement,
  { locale = 'en' as Locale }: { locale?: Locale } = {}
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Asia/Kolkata">
        {children}
      </NextIntlClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}

export { en, hi };
