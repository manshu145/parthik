import type { NavIconName, NavItem } from './nav-config';

/**
 * Vendor, driver and admin navigation — single source of truth.
 *
 * Every route in docs/ROUTES.md §6, §7 and §8 appears exactly once here. Nav
 * rendering, page generation and the route tests all read this, so a route cannot
 * exist in the sidebar but not on disk, or vice versa.
 *
 * Labels are i18n MESSAGE KEYS, never literals — the same rule as the customer
 * navigation.
 *
 * Admin items additionally carry the PERMISSION docs/ROUTES.md §8 requires. It is
 * recorded now, unused until TASK 003 supplies a permission engine, so the mapping
 * lives with the route rather than being reconstructed later from a table.
 */

export interface DashboardNavItem extends NavItem {
  /** Required permission, admin only (docs/ROUTES.md §8). */
  permission?: string;
}

export interface DashboardNavSection {
  id: string;
  titleKey: string;
  items: readonly DashboardNavItem[];
}

/** A route that needs a page file but is reached from a list, not the nav. */
export interface DashboardDetailRoute {
  /** Next.js route path, including dynamic segments. */
  path: string;
  labelKey: string;
  permission?: string;
}

// ---------------------------------------------------------------------------
// Vendor (docs/ROUTES.md §6)
// ---------------------------------------------------------------------------

export const VENDOR_NAV_ITEMS: readonly DashboardNavItem[] = [
  { id: 'vendor-overview', href: '/vendor', labelKey: 'overview', icon: 'grid' },
  { id: 'vendor-orders', href: '/vendor/orders', labelKey: 'orders', icon: 'package' },
  { id: 'vendor-products', href: '/vendor/products', labelKey: 'products', icon: 'tag' },
  { id: 'vendor-inventory', href: '/vendor/inventory', labelKey: 'inventory', icon: 'grid' },
  { id: 'vendor-categories', href: '/vendor/categories', labelKey: 'categories', icon: 'grid' },
  { id: 'vendor-store', href: '/vendor/store', labelKey: 'store', icon: 'mapPin' },
  { id: 'vendor-analytics', href: '/vendor/analytics', labelKey: 'analytics', icon: 'grid' },
  { id: 'vendor-payouts', href: '/vendor/payouts', labelKey: 'payouts', icon: 'tag' },
  { id: 'vendor-coupons', href: '/vendor/coupons', labelKey: 'coupons', icon: 'tag' },
  { id: 'vendor-documents', href: '/vendor/documents', labelKey: 'documents', icon: 'shield' },
  {
    id: 'vendor-notifications',
    href: '/vendor/notifications',
    labelKey: 'notifications',
    icon: 'bell',
  },
  { id: 'vendor-support', href: '/vendor/support', labelKey: 'support', icon: 'lifebuoy' },
  { id: 'vendor-settings', href: '/vendor/settings', labelKey: 'settings', icon: 'user' },
] as const;

export const VENDOR_DETAIL_ROUTES: readonly DashboardDetailRoute[] = [
  { path: '/vendor/orders/[id]', labelKey: 'orderDetail' },
  { path: '/vendor/products/new', labelKey: 'productNew' },
  { path: '/vendor/products/[id]/edit', labelKey: 'productEdit' },
  { path: '/vendor/products/import', labelKey: 'productImport' },
  // The onboarding gate: APPLIED / UNDER_REVIEW / REJECTED land here.
  { path: '/vendor/onboarding', labelKey: 'onboarding' },
] as const;

// ---------------------------------------------------------------------------
// Driver (docs/ROUTES.md §7)
// ---------------------------------------------------------------------------

export const DRIVER_NAV_ITEMS: readonly DashboardNavItem[] = [
  { id: 'driver-today', href: '/driver', labelKey: 'today', icon: 'grid' },
  { id: 'driver-available', href: '/driver/available', labelKey: 'available', icon: 'bell' },
  { id: 'driver-active', href: '/driver/active', labelKey: 'active', icon: 'mapPin' },
  { id: 'driver-history', href: '/driver/history', labelKey: 'history', icon: 'package' },
  { id: 'driver-earnings', href: '/driver/earnings', labelKey: 'earnings', icon: 'tag' },
  { id: 'driver-cash', href: '/driver/cash', labelKey: 'cash', icon: 'tag' },
  { id: 'driver-profile', href: '/driver/profile', labelKey: 'profile', icon: 'user' },
  { id: 'driver-documents', href: '/driver/documents', labelKey: 'documents', icon: 'shield' },
  { id: 'driver-support', href: '/driver/support', labelKey: 'support', icon: 'lifebuoy' },
  { id: 'driver-settings', href: '/driver/settings', labelKey: 'settings', icon: 'user' },
] as const;

export const DRIVER_DETAIL_ROUTES: readonly DashboardDetailRoute[] = [
  // D-20: OTP proof is mandatory; photo/signature is the exception path.
  { path: '/driver/active/[deliveryId]/proof', labelKey: 'proof' },
  { path: '/driver/cash/deposits/new', labelKey: 'depositNew' },
  { path: '/driver/onboarding', labelKey: 'onboarding' },
] as const;

// ---------------------------------------------------------------------------
// Admin (docs/ROUTES.md §8) — grouped so a 45-item sidebar stays usable
// ---------------------------------------------------------------------------

export const ADMIN_NAV_SECTIONS: readonly DashboardNavSection[] = [
  {
    id: 'admin-overview',
    titleKey: 'sections.overview',
    items: [
      { id: 'admin-home', href: '/admin', labelKey: 'dashboard', permission: 'dashboard:view' },
      {
        id: 'admin-analytics',
        href: '/admin/analytics',
        labelKey: 'analytics',
        permission: 'analytics:view',
      },
      {
        id: 'admin-reports',
        href: '/admin/reports',
        labelKey: 'reports',
        permission: 'report:view',
      },
    ],
  },
  {
    id: 'admin-commerce',
    titleKey: 'sections.commerce',
    items: [
      { id: 'admin-orders', href: '/admin/orders', labelKey: 'orders', permission: 'order:list' },
      {
        id: 'admin-products',
        href: '/admin/products',
        labelKey: 'products',
        permission: 'product:list',
      },
      {
        id: 'admin-categories',
        href: '/admin/categories',
        labelKey: 'categories',
        permission: 'category:manage',
      },
      { id: 'admin-brands', href: '/admin/brands', labelKey: 'brands', permission: 'brand:manage' },
      {
        id: 'admin-inventory',
        href: '/admin/inventory',
        labelKey: 'inventory',
        permission: 'inventory:view',
      },
      {
        id: 'admin-reviews',
        href: '/admin/reviews',
        labelKey: 'reviews',
        permission: 'review:moderate',
      },
    ],
  },
  {
    id: 'admin-people',
    titleKey: 'sections.people',
    items: [
      {
        id: 'admin-customers',
        href: '/admin/customers',
        labelKey: 'customers',
        permission: 'customer:list',
      },
      {
        id: 'admin-vendors',
        href: '/admin/vendors',
        labelKey: 'vendors',
        permission: 'vendor:list',
      },
      {
        id: 'admin-drivers',
        href: '/admin/drivers',
        labelKey: 'drivers',
        permission: 'driver:list',
      },
    ],
  },
  {
    id: 'admin-delivery',
    titleKey: 'sections.delivery',
    items: [
      {
        id: 'admin-delivery-board',
        href: '/admin/delivery',
        labelKey: 'deliveryBoard',
        permission: 'delivery:view',
      },
      {
        id: 'admin-zones',
        href: '/admin/delivery/zones',
        labelKey: 'zones',
        permission: 'zone:manage',
      },
    ],
  },
  {
    id: 'admin-money',
    titleKey: 'sections.money',
    items: [
      {
        id: 'admin-payments',
        href: '/admin/payments',
        labelKey: 'payments',
        permission: 'payment:view',
      },
      {
        id: 'admin-refunds',
        href: '/admin/payments/refunds',
        labelKey: 'refunds',
        permission: 'refund:manage',
      },
      {
        id: 'admin-payouts',
        href: '/admin/payouts',
        labelKey: 'payouts',
        permission: 'payout:manage',
      },
      // D-12 COD reconciliation.
      { id: 'admin-cash', href: '/admin/cash', labelKey: 'cash', permission: 'cash:view' },
      {
        id: 'admin-cash-deposits',
        href: '/admin/cash/deposits',
        labelKey: 'cashDeposits',
        permission: 'cash:reconcile',
      },
      {
        id: 'admin-cash-variances',
        href: '/admin/cash/variances',
        labelKey: 'cashVariances',
        permission: 'cash:view',
      },
    ],
  },
  {
    id: 'admin-marketing',
    titleKey: 'sections.marketing',
    items: [
      {
        id: 'admin-coupons',
        href: '/admin/coupons',
        labelKey: 'coupons',
        permission: 'coupon:manage',
      },
      {
        id: 'admin-promotions',
        href: '/admin/promotions',
        labelKey: 'promotions',
        permission: 'promotion:manage',
      },
      {
        id: 'admin-banners',
        href: '/admin/banners',
        labelKey: 'banners',
        permission: 'banner:manage',
      },
      {
        id: 'admin-notifications',
        href: '/admin/notifications',
        labelKey: 'notifications',
        permission: 'notification:manage',
      },
      {
        id: 'admin-templates',
        href: '/admin/notifications/templates',
        labelKey: 'templates',
        permission: 'template:manage',
      },
    ],
  },
  {
    id: 'admin-content',
    titleKey: 'sections.content',
    items: [
      { id: 'admin-cms', href: '/admin/cms', labelKey: 'cms', permission: 'cms:manage' },
      {
        id: 'admin-cms-home',
        href: '/admin/cms/home',
        labelKey: 'cmsHome',
        permission: 'cms:manage',
      },
      {
        id: 'admin-cms-blog',
        href: '/admin/cms/blog',
        labelKey: 'cmsBlog',
        permission: 'cms:manage',
      },
      {
        id: 'admin-cms-redirects',
        href: '/admin/cms/redirects',
        labelKey: 'cmsRedirects',
        permission: 'cms:manage',
      },
      // D-33 translation completeness.
      {
        id: 'admin-translations',
        href: '/admin/translations',
        labelKey: 'translations',
        permission: 'cms:manage',
      },
    ],
  },
  {
    id: 'admin-support',
    titleKey: 'sections.support',
    items: [
      {
        id: 'admin-tickets',
        href: '/admin/support',
        labelKey: 'support',
        permission: 'ticket:list',
      },
    ],
  },
  {
    id: 'admin-system',
    titleKey: 'sections.system',
    items: [
      {
        id: 'admin-settings',
        href: '/admin/settings',
        labelKey: 'settings',
        permission: 'setting:view',
      },
      {
        id: 'admin-cancellation',
        href: '/admin/settings/cancellation-policy',
        labelKey: 'cancellationPolicy',
        permission: 'setting:manage',
      },
      {
        id: 'admin-payment-settings',
        href: '/admin/settings/payments',
        labelKey: 'paymentSettings',
        permission: 'setting:manage_sensitive',
      },
      { id: 'admin-roles', href: '/admin/roles', labelKey: 'roles', permission: 'role:manage' },
      {
        id: 'admin-users',
        href: '/admin/users',
        labelKey: 'users',
        permission: 'admin_user:manage',
      },
      {
        id: 'admin-audit',
        href: '/admin/audit-logs',
        labelKey: 'auditLogs',
        permission: 'audit:view',
      },
      {
        id: 'admin-health',
        href: '/admin/system-health',
        labelKey: 'systemHealth',
        permission: 'system:view',
      },
      {
        id: 'admin-flags',
        href: '/admin/feature-flags',
        labelKey: 'flags',
        permission: 'flag:manage',
      },
    ],
  },
] as const;

export const ADMIN_DETAIL_ROUTES: readonly DashboardDetailRoute[] = [
  { path: '/admin/orders/[id]', labelKey: 'orderDetail', permission: 'order:view' },
  { path: '/admin/customers/[id]', labelKey: 'customerDetail', permission: 'customer:view' },
  { path: '/admin/vendors/[id]', labelKey: 'vendorDetail', permission: 'vendor:view' },
  { path: '/admin/drivers/[id]', labelKey: 'driverDetail', permission: 'driver:view' },
  { path: '/admin/products/[id]', labelKey: 'productDetail', permission: 'product:view' },
  { path: '/admin/cms/pages/[id]', labelKey: 'cmsPageDetail', permission: 'cms:manage' },
  { path: '/admin/support/[id]', labelKey: 'ticketDetail', permission: 'ticket:view' },
] as const;

/** Every admin nav item, flattened. */
export function adminNavItems(): DashboardNavItem[] {
  return ADMIN_NAV_SECTIONS.flatMap((section) => [...section.items]);
}

/**
 * Every dashboard route that must have a page file.
 *
 * Used by the route test to prove the sidebar and the filesystem agree — a link to
 * a route with no page is a 404 the customer finds before we do.
 */
export function allDashboardRoutes(): string[] {
  const paths = [
    ...VENDOR_NAV_ITEMS.map((item) => item.href),
    ...VENDOR_DETAIL_ROUTES.map((route) => route.path),
    ...DRIVER_NAV_ITEMS.map((item) => item.href),
    ...DRIVER_DETAIL_ROUTES.map((route) => route.path),
    ...adminNavItems().map((item) => item.href),
    ...ADMIN_DETAIL_ROUTES.map((route) => route.path),
  ];

  return [...new Set(paths)].sort();
}

/** Icon fallback so a nav item without one still renders consistently. */
export const DEFAULT_DASHBOARD_ICON: NavIconName = 'grid';

/**
 * A nav item whose label has already been translated.
 *
 * The shell is a Client Component, so it cannot be handed a translate FUNCTION —
 * React refuses to serialise functions across that boundary. Layouts resolve the
 * message keys on the server and pass this plain, serialisable shape instead.
 */
export interface ResolvedDashboardNavItem {
  id: string;
  href: string;
  label: string;
  icon: NavIconName;
  activePrefixes?: string[];
}

export interface ResolvedDashboardNavSection {
  id: string;
  /** Null for an ungrouped surface, where a heading would be noise. */
  title: string | null;
  items: readonly ResolvedDashboardNavItem[];
}

/** Translates a flat item list into the single section the shell renders. */
export function resolveNavItems(
  items: readonly DashboardNavItem[],
  translate: (key: string) => string
): ResolvedDashboardNavSection[] {
  return [{ id: 'main', title: null, items: items.map((item) => resolveItem(item, translate)) }];
}

/** Translates grouped sections, titles included. Admin only. */
export function resolveNavSections(
  sections: readonly DashboardNavSection[],
  translate: (key: string) => string
): ResolvedDashboardNavSection[] {
  return sections.map((section) => ({
    id: section.id,
    title: translate(section.titleKey),
    items: section.items.map((item) => resolveItem(item, translate)),
  }));
}

function resolveItem(
  item: DashboardNavItem,
  translate: (key: string) => string
): ResolvedDashboardNavItem {
  return {
    id: item.id,
    href: item.href,
    label: translate(item.labelKey),
    icon: item.icon ?? DEFAULT_DASHBOARD_ICON,
    ...(item.activePrefixes ? { activePrefixes: item.activePrefixes } : {}),
  };
}
