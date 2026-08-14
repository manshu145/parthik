'use client';

import { useEffect } from 'react';

/**
 * Registers the PWA service worker (master spec §38).
 *
 * Registration is deferred until after `load` so it never competes with the first
 * paint for bandwidth — a service worker that slows down the first visit is a net
 * loss.
 *
 * Registration is skipped in development, where a caching worker mostly produces
 * confusing stale-asset behaviour while iterating.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return;
    }

    const register = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // A failed registration must never surface to the user: the app works
        // fine without offline support.
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }

    return undefined;
  }, []);

  return null;
}
