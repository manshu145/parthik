import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ShopShell } from '@/components/layout/shop-shell';
import { getCurrentLocation } from '@/lib/shell/current-location';

/**
 * Authenticated customer layout (docs/ROUTES.md §2, §5).
 *
 * Same visual shell as the public shop, different CACHE AND INDEX posture: these
 * routes are private, so they are never indexed and never stored in a shared
 * cache. Middleware also sets `Cache-Control: private, no-store` for this prefix.
 *
 * Note `/cart` is GUEST-OK: it lives in this group for layout purposes but is not
 * session-gated, per the route access table.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function CustomerLayout({ children }: { children: ReactNode }) {
  // Read on the server so the header shows the chosen location on first paint.
  const initialLocation = await getCurrentLocation();

  return <ShopShell initialLocation={initialLocation}>{children}</ShopShell>;
}
