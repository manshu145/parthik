/* eslint-disable no-console */
import { createElement } from 'react';
import { mkdir, writeFile } from 'node:fs/promises';
import { ImageResponse } from 'next/og';
import en from '../messages/en.json' with { type: 'json' };

/**
 * Generates the Open Graph images as STATIC FILES, at build time.
 *
 * WHY NOT AT REQUEST TIME: this used to be `app/[locale]/opengraph-image.tsx`, which meant the
 * font rasteriser behind `next/og` — about 375 KB gzipped — was compiled into the Cloudflare
 * Worker. That pushed the Worker past its 3 MB script limit and broke the deploy, to render two
 * images that never change.
 *
 * A social crawler now gets a cached static asset instead of a Worker invocation, and the
 * deployable loses a third of a megabyte. Still typographic, still no photography or logo,
 * because there is no approved brand asset yet (D-07a).
 *
 * 🔴 ONE IMAGE, IN LATIN SCRIPT, FOR BOTH LOCALES — and that is a correction, not a shortcut.
 *
 * The route this replaces claimed to render a Hindi card. It did not: `satori`, the renderer
 * behind `next/og`, has no complex-script shaping, so it lays Devanagari out codepoint by
 * codepoint. The i-matra is not reordered, and "पार्थिक" came out as "पार्थकि" — visibly wrong to
 * every Hindi reader who saw a shared link, which is worse than an English card. The generated
 * output was checked, which is how this was found; the runtime route had been shipping it unseen.
 *
 * A real Hindi card needs a HarfBuzz-shaped, designed asset. That is brand work (it needs the
 * logo and the type choices that D-07a and the brand tokens are still waiting on), and when it
 * arrives it drops in here as a second file.
 *
 * Run with `pnpm og:generate` and COMMIT THE OUTPUT. It is regenerated only when the wording or
 * the brand colour changes, which is why a committed artefact beats a build step everyone has to
 * remember.
 */

/** Matches `viewport.themeColor` in the locale layout. */
const BRAND = '#1f7a52';
const SIZE = { width: 1200, height: 630 };

const IMAGES = [{ locale: 'en', file: 'opengraph-image.png', messages: en }] as const;

async function main(): Promise<void> {
  await mkdir('public', { recursive: true });

  for (const { locale, file, messages } of IMAGES) {
    const appName = messages.common.appName;
    const tagline = messages.common.tagline;

    const element = createElement(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: 24,
          padding: '80px',
          background: BRAND,
          color: '#ffffff',
          fontFamily: 'sans-serif',
        },
      },
      createElement(
        'div',
        { style: { fontSize: 108, fontWeight: 700, letterSpacing: -2 } },
        appName
      ),
      createElement('div', { style: { fontSize: 44, opacity: 0.92, lineHeight: 1.3 } }, tagline)
    );

    const response = new ImageResponse(element, SIZE);
    const buffer = Buffer.from(await response.arrayBuffer());

    await writeFile(`public/${file}`, buffer);
    console.log(`  ${locale}: public/${file} (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
  }
}

main().catch((error: unknown) => {
  console.error('Could not generate the Open Graph images:', error);
  process.exit(1);
});
