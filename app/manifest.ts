import type { MetadataRoute } from 'next';

/**
 * PWA manifest (master spec §38).
 *
 * The installable shell is foundation work; push notifications ship behind a flag
 * in TASK 017. Checkout and payment are explicitly NOT offline-capable, so the
 * offline experience is limited to browsing the cached shell.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Parthik',
    short_name: 'Parthik',
    description: 'Everyday essentials, delivered fast',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1f7a52',
    orientation: 'portrait',
    // Both supported languages are declared so the install prompt is coherent.
    lang: 'en-IN',
    dir: 'ltr',
    categories: ['shopping', 'food'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
