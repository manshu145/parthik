import type { ReactNode } from 'react';
import { ShopShell } from '@/components/layout/shop-shell';
import { getCurrentLocation } from '@/lib/shell/current-location';
import { getCartView } from '@/lib/shell/current-cart';
import { toCartSummary } from '@/lib/shell/cart-summary';
import { isLocale, defaultLocale } from '@/i18n/routing';

/**
 * Public commerce layout (docs/ROUTES.md §2).
 *
 * Wraps every public shop route in the customer shell. Route groups exist so each
 * surface gets its own layout and cache posture: this one is publicly cacheable
 * and indexable, unlike `(customer)`.
 */
export default async function ShopLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Read on the server so the header shows the chosen location and a correct
  // cart badge on first paint, rather than flashing empty on every navigation.
  const { locale } = await params;
  const resolved = isLocale(locale) ? locale : defaultLocale;

  const [initialLocation, cartView] = await Promise.all([
    getCurrentLocation(),
    getCartView(resolved),
  ]);

  return (
    <ShopShell initialLocation={initialLocation} initialCart={toCartSummary(cartView)}>
      {children}
    </ShopShell>
  );
}
