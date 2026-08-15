import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import hi from '@/messages/hi.json';
import {
  ADMIN_DETAIL_ROUTES,
  ADMIN_NAV_SECTIONS,
  DRIVER_DETAIL_ROUTES,
  DRIVER_NAV_ITEMS,
  VENDOR_DETAIL_ROUTES,
  VENDOR_NAV_ITEMS,
  adminNavItems,
  allDashboardRoutes,
  resolveNavItems,
  resolveNavSections,
} from '@/lib/navigation/dashboard-nav';

/**
 * Dashboard navigation manifest tests.
 *
 * The manifest is the single source of truth for three separate things: the
 * sidebar, the page files on disk, and the E2E route sweep. If they drift, a
 * customer-facing sidebar link 404s. These tests make drift a failing build
 * instead of a bug report.
 */

const APP_DIR = path.join(process.cwd(), 'app', '[locale]');

const SURFACE_DIRS = ['(vendor)', '(driver)', '(admin)'] as const;

/** Every page file that actually exists under the three dashboard surfaces. */
async function dashboardPageFiles(): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.name === 'page.tsx') files.push(absolute);
    }
  }

  for (const surface of SURFACE_DIRS) await walk(path.join(APP_DIR, surface));
  return files.sort();
}

/** Maps a route path to the page file that must back it. */
function pageFileFor(route: string): string {
  const surface = route.startsWith('/vendor')
    ? '(vendor)'
    : route.startsWith('/driver')
      ? '(driver)'
      : '(admin)';

  return path.join(APP_DIR, surface, route.slice(1), 'page.tsx');
}

describe('nav manifest and filesystem agree', () => {
  it.each(allDashboardRoutes())('%s has a page file', (route) => {
    expect(existsSync(pageFileFor(route)), `missing page for ${route}`).toBe(true);
  });

  it('has no page file that the manifest does not declare', async () => {
    // The other direction: an orphan page is a screen nobody can reach.
    const declared = new Set(allDashboardRoutes().map((route) => pageFileFor(route)));
    const found = await dashboardPageFiles();

    // Sanity check the sweep itself — a glob that matches nothing would make this
    // assertion pass while proving nothing.
    expect(found.length).toBe(77);
    expect(found.filter((file) => !declared.has(file))).toEqual([]);
  });

  it('covers all 77 documented dashboard routes', () => {
    // docs/ROUTES.md §6 (18) + §7 (13) + §8 (46).
    expect(allDashboardRoutes()).toHaveLength(77);
  });
});

describe('manifest integrity', () => {
  const everyItem = [...VENDOR_NAV_ITEMS, ...DRIVER_NAV_ITEMS, ...adminNavItems()];

  it('uses unique ids', () => {
    const ids = everyItem.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses unique hrefs within each surface', () => {
    for (const items of [VENDOR_NAV_ITEMS, DRIVER_NAV_ITEMS, adminNavItems()]) {
      const hrefs = items.map((item) => item.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });

  it('never hardcodes a label', () => {
    // Labels must be message keys, or the surface is English-only (D-33).
    for (const item of everyItem) {
      expect(item.labelKey).toMatch(/^[a-z][A-Za-z]*$/);
    }
  });

  it('records a permission for every admin route', () => {
    // docs/ROUTES.md §8. Unused until TASK 003, but reviewable now.
    for (const item of adminNavItems()) {
      expect(item.permission, `${item.href} has no permission`).toBeTruthy();
      expect(item.permission).toMatch(/^[a-z_]+:[a-z_]+$/);
    }
    for (const route of ADMIN_DETAIL_ROUTES) {
      expect(route.permission, `${route.path} has no permission`).toBeTruthy();
    }
  });

  it('does not put permissions on vendor or driver routes', () => {
    // Those surfaces gate on role plus ownership, not on granular permissions.
    for (const item of [...VENDOR_NAV_ITEMS, ...DRIVER_NAV_ITEMS]) {
      expect(item.permission).toBeUndefined();
    }
  });

  it('starts every route with its surface prefix', () => {
    for (const item of VENDOR_NAV_ITEMS) expect(item.href).toMatch(/^\/vendor/);
    for (const item of DRIVER_NAV_ITEMS) expect(item.href).toMatch(/^\/driver/);
    for (const item of adminNavItems()) expect(item.href).toMatch(/^\/admin/);
  });
});

describe('translations', () => {
  const NAMESPACES = {
    vendorNav: [...VENDOR_NAV_ITEMS, ...VENDOR_DETAIL_ROUTES].map(
      (entry) => entry.labelKey as string
    ),
    driverNav: [...DRIVER_NAV_ITEMS, ...DRIVER_DETAIL_ROUTES].map(
      (entry) => entry.labelKey as string
    ),
    adminNav: [...adminNavItems(), ...ADMIN_DETAIL_ROUTES].map((entry) => entry.labelKey as string),
  } as const;

  for (const [namespace, keys] of Object.entries(NAMESPACES)) {
    for (const locale of ['en', 'hi'] as const) {
      it(`${namespace} labels all resolve in ${locale}`, () => {
        const messages = (locale === 'en' ? en : hi) as Record<string, Record<string, unknown>>;
        const bundle = messages[namespace];

        expect(bundle, `${namespace} missing from ${locale}.json`).toBeDefined();
        for (const key of keys) {
          expect(bundle?.[key], `${namespace}.${key} missing from ${locale}.json`).toBeTruthy();
        }
        expect(bundle?.surface, `${namespace}.surface missing from ${locale}.json`).toBeTruthy();
      });
    }
  }

  it('translates every admin section title in both locales', () => {
    for (const locale of ['en', 'hi'] as const) {
      const messages = (locale === 'en' ? en : hi) as Record<string, Record<string, unknown>>;
      const sections = messages.adminNav?.sections as Record<string, string> | undefined;

      for (const section of ADMIN_NAV_SECTIONS) {
        const key = section.titleKey.replace('sections.', '');
        expect(
          sections?.[key],
          `adminNav.sections.${key} missing from ${locale}.json`
        ).toBeTruthy();
      }
    }
  });
});

describe('resolving navigation for the client shell', () => {
  const translate = (key: string) => `T:${key}`;

  it('produces plain serialisable data, never functions', () => {
    // Guards the bug this replaced: passing a translate function into the client
    // shell crashed every dashboard route with a React serialisation error.
    const groups = resolveNavSections(ADMIN_NAV_SECTIONS, translate);

    for (const group of groups) {
      expect(typeof group.title).toBe('string');
      for (const item of group.items) {
        for (const value of Object.values(item)) {
          expect(typeof value).not.toBe('function');
        }
      }
    }
    // Round-tripping through JSON is exactly what the boundary does.
    expect(JSON.parse(JSON.stringify(groups))).toEqual(groups);
  });

  it('translates labels and section titles', () => {
    const [section] = resolveNavSections(
      [{ id: 's', titleKey: 'sections.commerce', items: [adminNavItems()[0]!] }],
      translate
    );

    expect(section?.title).toBe('T:sections.commerce');
    expect(section?.items[0]?.label).toBe(`T:${adminNavItems()[0]!.labelKey}`);
  });

  it('renders a flat list as one untitled section', () => {
    const groups = resolveNavItems(VENDOR_NAV_ITEMS, translate);

    expect(groups).toHaveLength(1);
    // Null rather than an empty string: the shell must not render a blank heading.
    expect(groups[0]?.title).toBeNull();
    expect(groups[0]?.items).toHaveLength(VENDOR_NAV_ITEMS.length);
  });

  it('substitutes the default icon when an item declares none', () => {
    const groups = resolveNavItems([{ id: 'x', href: '/vendor', labelKey: 'overview' }], translate);

    expect(groups[0]?.items[0]?.icon).toBe('grid');
  });

  it('gives every resolved item an icon', () => {
    // The shell renders unconditionally, so a missing icon would break layout.
    for (const group of resolveNavSections(ADMIN_NAV_SECTIONS, translate)) {
      for (const item of group.items) expect(item.icon).toBeTruthy();
    }
  });
});
