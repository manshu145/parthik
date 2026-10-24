import type { ReactNode } from 'react';
import { ShopShell } from '@/components/layout/shop-shell';
import { getCurrentLocation } from '@/lib/shell/current-location';
import { getCartView } from '@/lib/shell/current-cart';
import { toCartSummary } from '@/lib/shell/cart-summary';
import { isLocale, defaultLocale } from '@/i18n/routing';

/**
 * Marketing and legal page layout (docs/ROUTES.md §3).
 *
 * Same shell as `(shop)`: these pages are reached from the footer, and dropping the
 * header and cart on the way to the refund policy would strand a customer
 * mid-purchase. Kept as its own group so its cache posture can diverge later —
 * legal copy changes rarely, product pages change constantly.
 */
export default async function MarketingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
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
