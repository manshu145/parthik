'use client';

import { Toaster as SonnerToaster } from 'sonner';

/**
 * Application-wide toast host (master spec §7 "Toast system").
 *
 * One provider, mounted once in the shell. Sonner is used rather than a
 * hand-rolled implementation because it already handles the accessibility
 * details: an `aria-live` region, screen-reader announcements, hover/focus pause,
 * and keyboard dismissal.
 *
 * Position is bottom-centre on mobile so a toast never sits under the bottom
 * navigation, and top-right on desktop where there is room.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      // Offset clears the 56px bottom nav plus the iOS home indicator.
      offset={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
      mobileOffset={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
      closeButton
      richColors
      // Long enough to read a sentence in either language without rushing.
      duration={5000}
      toastOptions={{
        classNames: {
          toast:
            'rounded-[var(--radius-control)] border border-border bg-background text-foreground shadow-[var(--shadow-raised)]',
          description: 'text-muted-foreground',
        },
      }}
      style={{ zIndex: 'var(--z-toast)' } as React.CSSProperties}
    />
  );
}

// Re-exported so call sites import from one place rather than reaching for the
// library directly — that keeps the toast provider swappable.
export { toast } from 'sonner';
