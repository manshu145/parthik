/**
 * Navigation single source of truth.
 *
 * Every navigation surface — mobile bottom nav, desktop header, footer, account
 * hub — is generated from these definitions. Nothing re-declares a route or a
 * label, so a route change happens in exactly one place (TASK 004 requirement:
 * "no duplicated navigation definitions").
 *
 * Routes are transcribed from docs/ROUTES.md. No route is invented here.
 *
 * Labels are i18n MESSAGE KEYS, never literal strings, so every surface works in
 * English and Hindi (D-33).
 */

/** Icon name resolved by the rendering component, keeping this file free of JSX. */
export type NavIconName =
  | 'home'
  | 'grid'
  | 'tag'
  | 'cart'
  | 'user'
  | 'heart'
  | 'search'
  | 'package'
  | 'bell'
  | 'shield'
  | 'lifebuoy'
  | 'mapPin';

export interface NavItem {
  /** Stable id, used as a React key and in tests. */
  id: string;
  /** Path from docs/ROUTES.md. Locale prefixing is applied by the Link helper. */
  href: string;
  /** i18n key under the `nav` namespace. */
  labelKey: string;
  icon?: NavIconName;
  /**
   * Additional path prefixes that should mark this item active. `/categories`
   * stays highlighted while browsing `/category/atta`, which is what users
   * expect from a tab bar.
   */
  activePrefixes?: string[];
  /** Requires an authenticated session; middleware gates these. */
  requiresAuth?: boolean;
  /** Shows a numeric badge (cart count). */
  showsBadge?: boolean;
}

/**
 * Mobile bottom navigation — exactly five items (master spec §7).
 *
 * Favorites is deliberately NOT here: the spec fixes this bar at five items and
 * routes Favorites through Account and product cards instead.
 */
export const BOTTOM_NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', href: '/', labelKey: 'home', icon: 'home' },
  {
    id: 'categories',
    href: '/categories',
    labelKey: 'categories',
    icon: 'grid',
    // Category detail pages keep this tab active.
    activePrefixes: ['/category'],
  },
  { id: 'offers', href: '/offers', labelKey: 'offers', icon: 'tag' },
  { id: 'cart', href: '/cart', labelKey: 'cart', icon: 'cart', showsBadge: true },
  {
    id: 'account',
    href: '/account',
    labelKey: 'account',
    icon: 'user',
    requiresAuth: true,
    activePrefixes: ['/orders'],
  },
] as const;

/** Primary desktop header links. Cart and account are rendered as actions. */
export const DESKTOP_NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'categories',
    href: '/categories',
    labelKey: 'categories',
    icon: 'grid',
    activePrefixes: ['/category'],
  },
  { id: 'offers', href: '/offers', labelKey: 'offers', icon: 'tag' },
  { id: 'favorites', href: '/favorites', labelKey: 'favorites', icon: 'heart', requiresAuth: true },
] as const;

/** Account hub, from docs/ROUTES.md §5. */
export const ACCOUNT_NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'profile',
    href: '/account/profile',
    labelKey: 'profile',
    icon: 'user',
    requiresAuth: true,
  },
  {
    id: 'addresses',
    href: '/account/addresses',
    labelKey: 'addresses',
    icon: 'mapPin',
    requiresAuth: true,
  },
  { id: 'orders', href: '/orders', labelKey: 'orders', icon: 'package', requiresAuth: true },
  { id: 'favorites', href: '/favorites', labelKey: 'favorites', icon: 'heart', requiresAuth: true },
  {
    id: 'notifications',
    href: '/account/notifications',
    labelKey: 'notifications',
    icon: 'bell',
    requiresAuth: true,
  },
  {
    id: 'security',
    href: '/account/security',
    labelKey: 'security',
    icon: 'shield',
    requiresAuth: true,
  },
  {
    id: 'support',
    href: '/account/support',
    labelKey: 'support',
    icon: 'lifebuoy',
    requiresAuth: true,
  },
] as const;

export interface FooterSection {
  id: string;
  titleKey: string;
  items: readonly NavItem[];
}

/**
 * Footer. Preserves the existing site's footer (master spec §2) — About, Privacy,
 * Terms, Vendor Registration, Driver Registration — and adds the remaining legal
 * pages that docs/ROUTES.md §3 defines.
 */
export const FOOTER_SECTIONS: readonly FooterSection[] = [
  {
    id: 'company',
    titleKey: 'company',
    items: [
      { id: 'about', href: '/about', labelKey: 'about' },
      { id: 'contact', href: '/contact', labelKey: 'contact' },
      { id: 'careers', href: '/careers', labelKey: 'careers' },
      { id: 'blog', href: '/blog', labelKey: 'blog' },
    ],
  },
  {
    id: 'legal',
    titleKey: 'legal',
    items: [
      { id: 'privacy', href: '/privacy', labelKey: 'privacy' },
      { id: 'terms', href: '/terms', labelKey: 'terms' },
      { id: 'refund-policy', href: '/refund-policy', labelKey: 'refundPolicy' },
      { id: 'shipping-policy', href: '/shipping-policy', labelKey: 'shippingPolicy' },
      { id: 'cancellation-policy', href: '/cancellation-policy', labelKey: 'cancellationPolicy' },
    ],
  },
  {
    id: 'partners',
    titleKey: 'partners',
    items: [
      { id: 'vendor-registration', href: '/vendor-registration', labelKey: 'vendorRegistration' },
      { id: 'driver-registration', href: '/driver-registration', labelKey: 'driverRegistration' },
    ],
  },
  {
    id: 'help',
    titleKey: 'help',
    items: [
      { id: 'faq', href: '/faq', labelKey: 'faq' },
      { id: 'support', href: '/account/support', labelKey: 'support', requiresAuth: true },
    ],
  },
] as const;

/**
 * Whether a nav item should render as active for the current path.
 *
 * Exact match for `/`, otherwise prefix match on the item's own href plus any
 * declared `activePrefixes`. Prefix matching is boundary-aware: `/categories`
 * must not light up for `/categories-archive`.
 */
export function isNavItemActive(pathname: string, item: NavItem): boolean {
  const path = normalisePath(pathname);

  // Home is only active on the exact root, or it would match everything.
  if (item.href === '/') return path === '/';

  const candidates = [item.href, ...(item.activePrefixes ?? [])];
  return candidates.some((candidate) => path === candidate || path.startsWith(`${candidate}/`));
}

/** Trims a trailing slash so `/cart/` and `/cart` behave identically. */
function normalisePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname || '/';
}

/** Every distinct route referenced by navigation. Used by tests and the sitemap. */
export function allNavigationHrefs(): string[] {
  const hrefs = new Set<string>();

  for (const item of [...BOTTOM_NAV_ITEMS, ...DESKTOP_NAV_ITEMS, ...ACCOUNT_NAV_ITEMS]) {
    hrefs.add(item.href);
  }
  for (const section of FOOTER_SECTIONS) {
    for (const item of section.items) hrefs.add(item.href);
  }

  return [...hrefs].sort();
}
