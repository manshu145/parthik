'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ShellProvider } from '@/components/providers/shell-provider';
import type { CartSummary, SelectedLocation } from '@/lib/shell/types';
import { Toaster } from '@/components/providers/toaster';
import { ServiceWorkerRegistration } from '@/components/providers/service-worker-registration';
import { SiteHeader } from './site-header';
import { SiteFooter } from './site-footer';
import { BottomNav } from './bottom-nav';
import { CartDrawer } from './cart-drawer';
import { LocationSheet } from './location-selector';
import { OfflineBanner } from './offline-banner';
import { SkipLink } from './skip-link';

/**
 * Customer application shell.
 *
 * Composes every shell surface once, in one place, so no page re-declares
 * navigation:
 *
 *   skip link → offline banner → header → main → footer → bottom nav
 *   plus the cart drawer, location sheet and toast host
 *
 * Landmark structure is deliberate: exactly one `<main id="main">` for the skip
 * link to target, `<header>`/`<footer>` for the banner and contentinfo landmarks,
 * and navigation regions that each carry an accessible name.
 *
 * `pb-24 md:pb-0` on main reserves room for the fixed bottom bar so the last
 * element of a page is never hidden behind it — a small detail that is very
 * obvious when it is missing.
 */
export function ShopShell({
  children,
  initialLocation,
  initialCart,
}: {
  children: ReactNode;
  /** Resolved from the location cookie by the server layout. */
  initialLocation?: SelectedLocation;
  /** Priced server-side so the badge and drawer are right on first paint. */
  initialCart?: CartSummary;
}) {
  const t = useTranslations('nav');

  return (
    <ShellProvider initialLocation={initialLocation} initialCart={initialCart}>
      <SkipLink label={t('skipToContent')} />
      <OfflineBanner />

      <div className="flex min-h-dvh flex-col">
        <SiteHeader />

        <main id="main" tabIndex={-1} className="flex-1 pb-24 outline-none md:pb-0">
          {children}
        </main>

        <SiteFooter />
      </div>

      <BottomNav />

      {/* Overlays live outside the layout flow so they are not clipped by it. */}
      <CartDrawer />
      <LocationSheet />
      <Toaster />
      <ServiceWorkerRegistration />
    </ShellProvider>
  );
}
