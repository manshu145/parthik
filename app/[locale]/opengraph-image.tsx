import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { defaultLocale, isLocale } from '@/i18n/routing';

/**
 * Site-wide Open Graph image (master spec §20).
 *
 * GENERATED, not a hand-made file, for one reason: it has to exist in both
 * languages. A single English PNG shared by the Hindi pages would be the one part of
 * a shared link that stayed untranslated, which is exactly the sort of thing that
 * makes a bilingual product feel half-finished.
 *
 * Deliberately typographic — no photography, no logo file. There is no approved
 * brand asset yet (D-07a covers image storage), and a placeholder graphic in
 * everyone's social previews would be worse than clean type.
 */

export const alt = 'Parthik';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Matches the brand green used by `viewport.themeColor` in the locale layout. */
const BRAND = '#1f7a52';

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const resolved = isLocale(locale) ? locale : defaultLocale;
  const t = await getTranslations({ locale: resolved, namespace: 'common' });

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 24,
        background: BRAND,
        padding: 80,
        // Satori has no default font stack, so the family is stated explicitly.
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 700, color: '#ffffff', letterSpacing: -2 }}>
        {t('appName')}
      </div>
      <div style={{ fontSize: 40, color: '#d9ede4', lineHeight: 1.3 }}>{t('tagline')}</div>
    </div>,
    size
  );
}
