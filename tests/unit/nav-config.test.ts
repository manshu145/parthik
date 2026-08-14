import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import hi from '@/messages/hi.json';
import {
  ACCOUNT_NAV_ITEMS,
  BOTTOM_NAV_ITEMS,
  DESKTOP_NAV_ITEMS,
  FOOTER_SECTIONS,
  allNavigationHrefs,
  isNavItemActive,
  type NavItem,
} from '@/lib/navigation/nav-config';

/**
 * Navigation configuration tests.
 *
 * The navigation config is the single source of truth for every nav surface, so
 * these tests guard the three things that would break the shell quietly:
 * an invented route, a missing translation, or wrong active-state matching.
 */

/** Routes that exist in docs/ROUTES.md. Anything outside this set is invented. */
const DOCUMENTED_ROUTES = new Set([
  // (marketing) §3
  '/about',
  '/contact',
  '/faq',
  '/privacy',
  '/terms',
  '/refund-policy',
  '/shipping-policy',
  '/cancellation-policy',
  '/careers',
  '/blog',
  '/vendor-registration',
  '/driver-registration',
  // (shop) §4
  '/',
  '/categories',
  '/offers',
  '/search',
  // (customer) §5
  '/cart',
  '/checkout',
  '/favorites',
  '/orders',
  '/account',
  '/account/profile',
  '/account/addresses',
  '/account/notifications',
  '/account/security',
  '/account/support',
  '/login',
]);

const allItems: NavItem[] = [
  ...BOTTOM_NAV_ITEMS,
  ...DESKTOP_NAV_ITEMS,
  ...ACCOUNT_NAV_ITEMS,
  ...FOOTER_SECTIONS.flatMap((section) => section.items),
];

function flatten(source: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result[path] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flatten(value as Record<string, unknown>, path));
    }
  }
  return result;
}

const flatEn = flatten(en as Record<string, unknown>);
const flatHi = flatten(hi as Record<string, unknown>);

describe('bottom navigation (master spec §7)', () => {
  it('has exactly five items', () => {
    // The spec fixes this bar at five. Favorites deliberately lives elsewhere.
    expect(BOTTOM_NAV_ITEMS).toHaveLength(5);
  });

  it('is Home, Categories, Offers, Cart, Account in that order', () => {
    expect(BOTTOM_NAV_ITEMS.map((item) => item.id)).toEqual([
      'home',
      'categories',
      'offers',
      'cart',
      'account',
    ]);
  });

  it('points at the documented routes', () => {
    expect(BOTTOM_NAV_ITEMS.map((item) => item.href)).toEqual([
      '/',
      '/categories',
      '/offers',
      '/cart',
      '/account',
    ]);
  });

  it('gives every item an icon, since the bar is icon-led', () => {
    for (const item of BOTTOM_NAV_ITEMS) {
      expect(item.icon, `${item.id} needs an icon`).toBeDefined();
    }
  });

  it('shows a badge only on the cart', () => {
    const badged = BOTTOM_NAV_ITEMS.filter((item) => item.showsBadge).map((item) => item.id);
    expect(badged).toEqual(['cart']);
  });
});

describe('route integrity', () => {
  it('invents no routes outside docs/ROUTES.md', () => {
    const invented = allNavigationHrefs().filter((href) => !DOCUMENTED_ROUTES.has(href));
    expect(invented, `Undocumented routes: ${invented.join(', ')}`).toEqual([]);
  });

  it('uses absolute internal paths only', () => {
    for (const item of allItems) {
      expect(item.href.startsWith('/'), `${item.id} must be an internal path`).toBe(true);
      expect(item.href.startsWith('//'), `${item.id} must not be protocol-relative`).toBe(false);
    }
  });

  it('never hardcodes a locale prefix into an href', () => {
    // Locale prefixing is the Link helper's job; a hardcoded /hi would strand
    // English users.
    for (const item of allItems) {
      expect(item.href.startsWith('/hi/'), `${item.id} must not hardcode a locale`).toBe(false);
      expect(item.href).not.toBe('/hi');
    }
  });

  it('has no duplicate ids within a single surface', () => {
    const surfaces: Array<[string, readonly NavItem[]]> = [
      ['bottom', BOTTOM_NAV_ITEMS],
      ['desktop', DESKTOP_NAV_ITEMS],
      ['account', ACCOUNT_NAV_ITEMS],
      ...FOOTER_SECTIONS.map(
        (section) => [`footer:${section.id}`, section.items] as [string, readonly NavItem[]]
      ),
    ];

    for (const [name, items] of surfaces) {
      const ids = items.map((item) => item.id);
      expect(new Set(ids).size, `${name} has duplicate ids`).toBe(ids.length);
    }
  });

  it('marks private routes as requiring auth', () => {
    const privatePrefixes = ['/account', '/orders', '/favorites'];

    for (const item of allItems) {
      const isPrivate = privatePrefixes.some(
        (prefix) => item.href === prefix || item.href.startsWith(`${prefix}/`)
      );
      if (isPrivate) {
        expect(item.requiresAuth, `${item.href} should be marked requiresAuth`).toBe(true);
      }
    }
  });

  it('does not mark the guest-accessible cart as requiring auth', () => {
    // /cart is GUEST-OK per docs/ROUTES.md §5.
    const cart = BOTTOM_NAV_ITEMS.find((item) => item.id === 'cart');
    expect(cart?.requiresAuth).toBeUndefined();
  });
});

describe('i18n labels', () => {
  it('resolves every nav label in English and Hindi', () => {
    const missing: string[] = [];

    for (const item of [...BOTTOM_NAV_ITEMS, ...DESKTOP_NAV_ITEMS, ...ACCOUNT_NAV_ITEMS]) {
      const key = `nav.${item.labelKey}`;
      if (!(key in flatEn)) missing.push(`en:${key}`);
      if (!(key in flatHi)) missing.push(`hi:${key}`);
    }

    expect(missing, `Missing nav translations: ${missing.join(', ')}`).toEqual([]);
  });

  it('resolves every footer label and section title in both locales', () => {
    const missing: string[] = [];

    for (const section of FOOTER_SECTIONS) {
      for (const key of [
        `footer.${section.titleKey}`,
        ...section.items.map((item) => `footer.${item.labelKey}`),
      ]) {
        if (!(key in flatEn)) missing.push(`en:${key}`);
        if (!(key in flatHi)) missing.push(`hi:${key}`);
      }
    }

    expect(missing, `Missing footer translations: ${missing.join(', ')}`).toEqual([]);
  });

  it('uses message keys rather than literal labels', () => {
    // A label containing a space is almost certainly display text that slipped in.
    for (const item of allItems) {
      expect(item.labelKey).not.toContain(' ');
      expect(item.labelKey.length).toBeGreaterThan(0);
    }
  });
});

describe('active state matching', () => {
  const home = BOTTOM_NAV_ITEMS[0]!;
  const categories = BOTTOM_NAV_ITEMS[1]!;
  const cart = BOTTOM_NAV_ITEMS[3]!;
  const account = BOTTOM_NAV_ITEMS[4]!;

  it('activates Home only on the exact root', () => {
    expect(isNavItemActive('/', home)).toBe(true);
    // Prefix matching on '/' would light up Home on every page.
    expect(isNavItemActive('/categories', home)).toBe(false);
    expect(isNavItemActive('/cart', home)).toBe(false);
  });

  it('keeps Categories active on a category detail page', () => {
    expect(isNavItemActive('/categories', categories)).toBe(true);
    expect(isNavItemActive('/category/fruits-vegetables', categories)).toBe(true);
  });

  it('keeps Account active on the orders route', () => {
    expect(isNavItemActive('/account', account)).toBe(true);
    expect(isNavItemActive('/account/profile', account)).toBe(true);
    expect(isNavItemActive('/orders', account)).toBe(true);
    expect(isNavItemActive('/orders/abc123', account)).toBe(true);
  });

  it('matches on path boundaries, not bare string prefixes', () => {
    // '/categories-archive' must not activate '/categories'.
    expect(isNavItemActive('/categories-archive', categories)).toBe(false);
    expect(isNavItemActive('/cartons', cart)).toBe(false);
  });

  it('ignores a trailing slash', () => {
    expect(isNavItemActive('/cart/', cart)).toBe(true);
    expect(isNavItemActive('/', home)).toBe(true);
  });

  it('activates exactly one bottom-nav item per route', () => {
    // Two highlighted tabs is a visible bug; this catches an overlapping prefix.
    for (const path of [
      '/',
      '/categories',
      '/category/x',
      '/offers',
      '/cart',
      '/account',
      '/orders',
    ]) {
      const active = BOTTOM_NAV_ITEMS.filter((item) => isNavItemActive(path, item));
      expect(active.length, `${path} activated: ${active.map((i) => i.id).join(', ')}`).toBe(1);
    }
  });

  it('activates nothing for an unrelated route', () => {
    const active = BOTTOM_NAV_ITEMS.filter((item) => isNavItemActive('/about', item));
    expect(active).toEqual([]);
  });
});
