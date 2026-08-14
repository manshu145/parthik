import type { ReactNode } from 'react';
import { ShopShell } from '@/components/layout/shop-shell';
import { getCurrentLocation } from '@/lib/shell/current-location';

/**
 * Public commerce layout (docs/ROUTES.md §2).
 *
 * Wraps every public shop route in the customer shell. Route groups exist so each
 * surface gets its own layout and cache posture: this one is publicly cacheable
 * and indexable, unlike `(customer)`.
 */
export default async function ShopLayout({ children }: { children: ReactNode }) {
  // Read on the server so the header shows the chosen location on first paint.
  const initialLocation = await getCurrentLocation();

  return <ShopShell initialLocation={initialLocation}>{children}</ShopShell>;
}
