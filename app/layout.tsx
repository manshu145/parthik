import type { ReactNode } from 'react';

/**
 * Root layout.
 *
 * Intentionally minimal: `app/[locale]/layout.tsx` owns <html> and <body> so it
 * can set the correct `lang` attribute per locale (D-33). This root exists only
 * to satisfy the App Router's requirement for a top-level layout and to host
 * global error boundaries.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
