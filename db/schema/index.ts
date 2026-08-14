/**
 * Database schema barrel (docs/DATABASE.md).
 *
 * Import order reflects dependency direction, which is also why the domains are
 * split the way they are — `marketing` sits before `commerce` because orders
 * reference coupons, and `coupon_usages` lives in `commerce` because it
 * references orders. Keeping that acyclic is what lets Drizzle resolve foreign
 * keys without circular imports.
 *
 * MIGRATIONS ARE NOT GENERATED. This is the design that migrations will be
 * generated from once that step is explicitly authorized.
 */

// Enum types
export * from './enums';

// Identity and access (§3)
export * from './identity';

// Serviceability (§5)
export * from './location';

// CMS, SEO, locale lookup, reference tables (§10)
export * from './cms';

// Vendors and stores (§5)
export * from './marketplace';

// Catalog (§5)
export * from './catalog';

// Stock (§6.1)
export * from './inventory';

// Customer profiles, addresses, favorites (§4)
export * from './customer';

// Coupons, promotions, banners, cancellation policy (§6, master spec §18)
export * from './marketing';

// Carts and orders (§6)
export * from './commerce';

// Payments, refunds, invoices, payouts (§6)
export * from './payments';

// Drivers, deliveries, dispatch, COD cash ledger (§8, §6.2)
export * from './delivery';

// Reviews, notifications, support (§9)
export * from './engagement';

// Localised content (§10.1)
export * from './translations';

// Settings, flags, audit, system events (§11)
export * from './admin';
