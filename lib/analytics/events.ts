/**
 * Analytics event allowlist (master spec §36, decision D-28).
 *
 * Defined once. Anything not in this list is not tracked — an allowlist keeps
 * event sprawl and accidental PII capture from creeping in.
 *
 * GA4 naming note: GA4 reserves and auto-collects some names, and its
 * recommended vocabulary differs slightly from the master spec's list. The spec
 * names are the internal contract; `GA4_EVENT_NAMES` maps them to what GA4
 * expects, so neither document has to bend to the other.
 */

export const ANALYTICS_EVENTS = [
  'page_view',
  'location_selected',
  'search',
  'product_view',
  'add_to_cart',
  'remove_from_cart',
  'wishlist_add',
  'checkout_started',
  'coupon_applied',
  'payment_started',
  'payment_success',
  'order_created',
  'order_cancelled',
  'order_delivered',
  'signup',
  'login',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Master-spec event name -> GA4 event name. */
export const GA4_EVENT_NAMES: Record<AnalyticsEvent, string> = {
  page_view: 'page_view',
  location_selected: 'location_selected',
  search: 'search',
  product_view: 'view_item',
  add_to_cart: 'add_to_cart',
  remove_from_cart: 'remove_from_cart',
  wishlist_add: 'add_to_wishlist',
  checkout_started: 'begin_checkout',
  coupon_applied: 'select_promotion',
  payment_started: 'add_payment_info',
  payment_success: 'purchase',
  order_created: 'order_created',
  order_cancelled: 'refund',
  order_delivered: 'order_delivered',
  signup: 'sign_up',
  login: 'login',
};

/**
 * Events emitted SERVER-SIDE via the GA4 Measurement Protocol.
 *
 * These represent money and must not depend on a browser: an ad blocker or a
 * closed tab would otherwise lose a conversion (docs/ARCHITECTURE.md §11.7).
 */
export const SERVER_SIDE_EVENTS: ReadonlySet<AnalyticsEvent> = new Set([
  'order_created',
  'payment_success',
  'order_cancelled',
  'order_delivered',
]);

/**
 * Property values allowed in analytics payloads.
 *
 * Deliberately primitives only. No nested objects, which is how address or
 * customer records tend to get swept into an event by accident.
 */
export type AnalyticsProperties = Record<string, string | number | boolean | undefined>;

/** Property keys that must never be sent to an analytics provider. */
const FORBIDDEN_PROPERTY_KEYS = [
  /phone/i,
  /email/i,
  /otp/i,
  /token/i,
  /address/i,
  /line1/i,
  /line2/i,
  /pincode/i,
  /card/i,
  /name$/i,
];

/**
 * Strips forbidden keys. Analytics must carry a pseudonymous id and nothing
 * personally identifying (master spec §36, docs/SECURITY.md §9.4).
 */
export function sanitiseProperties(properties: AnalyticsProperties): AnalyticsProperties {
  const result: AnalyticsProperties = {};

  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    if (FORBIDDEN_PROPERTY_KEYS.some((pattern) => pattern.test(key))) continue;
    result[key] = value;
  }

  return result;
}
