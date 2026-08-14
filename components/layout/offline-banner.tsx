'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { WifiOff } from 'lucide-react';

/**
 * Network-aware offline banner (master spec §25, §38).
 *
 * Browsing works from the cached app shell, but placing an order does not — so the
 * banner is honest about the difference rather than implying the app is fully
 * usable offline.
 *
 * Implemented with `useSyncExternalStore` because `navigator.onLine` IS an
 * external store. That gives a correct server snapshot (always "online", so the
 * banner never renders in SSR HTML and cannot cause a hydration mismatch) without
 * the setState-inside-an-effect pattern.
 *
 * Caveat worth knowing: `navigator.onLine` reports link state, not reachability,
 * so a captive portal or a dead upstream still reads as online. The browser's
 * online/offline events are the best signal available without polling a server.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);

  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const getClientSnapshot = (): boolean => navigator.onLine;

/** Assume online on the server: the banner is a client-only enhancement. */
const getServerSnapshot = (): boolean => true;

export function OfflineBanner() {
  const t = useTranslations('states.offline');
  const isOnline = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="bg-warning text-warning-foreground flex items-center justify-center gap-2 px-4 py-2 text-center text-sm"
    >
      <WifiOff aria-hidden="true" className="size-4 shrink-0" />
      <span>{t('title')}</span>
    </div>
  );
}
