/**
 * Typed placeholder contracts for the application shell.
 *
 * ⚠️ TASK 004 SCOPE: the shell renders these shapes but nothing populates them
 * from the database yet. Real values arrive with their owning task:
 *
 *   CartSummary       -> TASK 008 (cart)
 *   SelectedLocation  -> TASK 005 (location and serviceability)
 *   NotificationBadge -> TASK 017 (notifications)
 *
 * They are defined here, in `lib/`, so the shell can be built and tested against
 * a stable contract without importing a business module — which the architecture
 * boundaries forbid for components anyway.
 *
 * No pricing, no serviceability and no cart arithmetic happens in the shell. The
 * shell DISPLAYS these values; the `pricing` module computes them.
 */

/**
 * Cart summary shown in the header badge and drawer.
 *
 * All money is integer paise (docs/ARCHITECTURE.md §2 principle 6). The shell
 * only formats these; it never adds them up.
 */
export interface CartSummary {
  /** Total item count across lines, for the badge. */
  itemCount: number;
  /** Server-computed total. The shell must not derive this. */
  totalAmountPaise: number;
  /** Server-computed gap to free delivery, or null when already free/unknown. */
  freeDeliveryGapPaise: number | null;
  lines: readonly CartSummaryLine[];
}

export interface CartSummaryLine {
  id: string;
  productName: string;
  variantLabel: string | null;
  unitLabel: string | null;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  imageKey: string | null;
}

export const EMPTY_CART_SUMMARY: CartSummary = {
  itemCount: 0,
  totalAmountPaise: 0,
  freeDeliveryGapPaise: null,
  lines: [],
};

/**
 * The customer's chosen delivery location.
 *
 * Serviceability is resolved server-side and re-verified at checkout
 * (master spec §11); the shell only shows the outcome.
 */
export interface SelectedLocation {
  /** Short label for the header, e.g. "452001" or "Vijay Nagar". */
  label: string;
  pincode: string | null;
  city: string | null;
  /** Resolved delivery zone id, when serviceable. */
  zoneId: string | null;
  isServiceable: boolean;
  /** Whether this came from browser geolocation or a manual choice. */
  source: 'detected' | 'manual' | 'saved-address' | 'none';
}

export const NO_LOCATION: SelectedLocation = {
  label: '',
  pincode: null,
  city: null,
  zoneId: null,
  isServiceable: false,
  source: 'none',
};

/** Unread in-app notification count for the header bell. */
export interface NotificationBadge {
  unreadCount: number;
}
