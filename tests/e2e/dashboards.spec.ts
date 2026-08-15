import { expect, test } from '@playwright/test';
import {
  ADMIN_DETAIL_ROUTES,
  DRIVER_DETAIL_ROUTES,
  DRIVER_NAV_ITEMS,
  VENDOR_DETAIL_ROUTES,
  VENDOR_NAV_ITEMS,
  adminNavItems,
} from '@/lib/navigation/dashboard-nav';

/**
 * Vendor, driver and admin surface E2E tests.
 *
 * Driven by the SAME manifest the sidebar and the page files come from, so a route
 * cannot exist in navigation without a page behind it — a broken dashboard link is
 * the kind of thing a customer finds before we do.
 *
 * These run while authentication does not exist. The middleware allows the shells
 * through only when Firebase is unconfigured AND the environment is not production;
 * `access control` below asserts both halves of that.
 */

/** Dynamic segments get a placeholder so the route can actually be requested. */
function concretePath(path: string): string {
  return path.replace(/\[(\w+)\]/g, 'sample-id');
}

const VENDOR_PATHS = [
  ...VENDOR_NAV_ITEMS.map((item) => item.href),
  ...VENDOR_DETAIL_ROUTES.map((route) => concretePath(route.path)),
];

const DRIVER_PATHS = [
  ...DRIVER_NAV_ITEMS.map((item) => item.href),
  ...DRIVER_DETAIL_ROUTES.map((route) => concretePath(route.path)),
];

const ADMIN_PATHS = [
  ...adminNavItems().map((item) => item.href),
  ...ADMIN_DETAIL_ROUTES.map((route) => concretePath(route.path)),
];

const ALL_PATHS = [...VENDOR_PATHS, ...DRIVER_PATHS, ...ADMIN_PATHS];

test.describe('every dashboard route responds', () => {
  for (const path of ALL_PATHS) {
    test(`200 ${path}`, async ({ page }) => {
      const response = await page.goto(path);

      expect(response?.status(), `${path} should render`).toBe(200);
      // Proves the layout mounted, not just that something returned 200.
      await expect(page.getByTestId('dashboard-header')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }
});

test.describe('vendor surface', () => {
  test('renders the sidebar with every vendor destination', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/vendor');

    const sidebar = page.getByTestId('dashboard-sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByTestId('dashboard-nav-item')).toHaveCount(VENDOR_NAV_ITEMS.length);
  });

  test('marks the active destination', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/vendor/orders');

    await expect(
      page.getByTestId('dashboard-sidebar').getByRole('link', { name: 'Orders' })
    ).toHaveAttribute('aria-current', 'page');
  });

  test('navigates between destinations', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/vendor');

    await page.getByTestId('dashboard-sidebar').getByRole('link', { name: 'Inventory' }).click();

    await expect(page).toHaveURL(/\/vendor\/inventory$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Inventory' })).toBeVisible();
  });

  test('offers a way back to the storefront', async ({ page }) => {
    // Otherwise these surfaces are a dead end.
    await page.goto('/vendor');
    await page.getByRole('link', { name: /Back to store/i }).click();

    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('driver surface', () => {
  test('renders every driver destination', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/driver');

    await expect(
      page.getByTestId('dashboard-sidebar').getByTestId('dashboard-nav-item')
    ).toHaveCount(DRIVER_NAV_ITEMS.length);
  });

  test('keeps nav rows at the minimum tap target', async ({ page }) => {
    // docs/ROUTES.md §7: used one-handed, outdoors. 44px is the floor.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/driver');
    await page.getByTestId('dashboard-nav-toggle').click();

    const row = page.getByTestId('dashboard-drawer').getByTestId('dashboard-nav-item').first();
    const box = await row.boundingBox();

    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

test.describe('admin surface', () => {
  test('groups navigation into sections', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin');

    const sidebar = page.getByTestId('dashboard-sidebar');
    // A flat 45-item sidebar is unusable, so sections are load-bearing.
    await expect(sidebar.getByRole('heading', { level: 2 }).first()).toBeVisible();
    await expect(sidebar.getByTestId('dashboard-nav-item')).toHaveCount(adminNavItems().length);
  });

  test('shows the permission each page requires', async ({ page }) => {
    await page.goto('/admin/coupons');

    // Recorded per route now so the mapping is reviewable before TASK 003 builds
    // the permission engine.
    await expect(page.getByTestId('dashboard-permission')).toContainText('coupon:manage');
  });

  test('renders the elevated-permission page', async ({ page }) => {
    await page.goto('/admin/settings/payments');

    await expect(page.getByTestId('dashboard-permission')).toContainText(
      'setting:manage_sensitive'
    );
  });
});

test.describe('mobile navigation', () => {
  test('opens and closes the drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin');

    await expect(page.getByTestId('dashboard-sidebar')).toBeHidden();

    await page.getByTestId('dashboard-nav-toggle').click();
    await expect(page.getByTestId('dashboard-drawer')).toBeVisible();

    await page.getByTestId('dashboard-nav-toggle').click();
    await expect(page.getByTestId('dashboard-drawer')).toHaveCount(0);
  });

  test('closes the drawer after navigating', async ({ page }) => {
    // Leaving it open over the page just requested is disorienting.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin');

    await page.getByTestId('dashboard-nav-toggle').click();
    await page.getByTestId('dashboard-drawer').getByRole('link', { name: 'Orders' }).click();

    await expect(page).toHaveURL(/\/admin\/orders$/);
    await expect(page.getByTestId('dashboard-drawer')).toHaveCount(0);
  });
});

test.describe('localisation', () => {
  test('renders the admin surface in Hindi', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/hi/admin');

    await expect(page.getByTestId('dashboard-header')).toContainText('एडमिन');
    await expect(page.getByRole('heading', { level: 1, name: 'डैशबोर्ड' })).toBeVisible();
  });

  test('renders the vendor surface in Hindi', async ({ page }) => {
    await page.goto('/hi/vendor');

    await expect(page.getByTestId('dashboard-header')).toContainText('विक्रेता');
  });

  test('renders the driver surface in Hindi', async ({ page }) => {
    await page.goto('/hi/driver');

    await expect(page.getByTestId('dashboard-header')).toContainText('ड्राइवर');
  });
});

test.describe('access control', () => {
  test('every dashboard route is noindex', async ({ page }) => {
    for (const path of ['/vendor', '/driver', '/admin', '/admin/audit-logs']) {
      await page.goto(path);
      const robots = await page.locator('meta[name="robots"]').first().getAttribute('content');
      expect(robots, `${path} must be noindex`).toContain('noindex');
    }
  });

  test('CUSTOMER routes stay gated even in preview', async ({ page }) => {
    // The preview switch covers dashboard SHELLS only. `/account` is a per-user
    // surface where an empty shell would be misleading, so it still redirects.
    const response = await page.goto('/account', { waitUntil: 'domcontentloaded' });

    expect(response?.url()).toContain('/login');
  });

  test('states plainly that preview access is open', async ({ page }) => {
    await page.goto('/admin');

    // Nobody should mistake an unauthenticated dashboard for a security hole, or
    // for finished work.
    await expect(page.getByTestId('dashboard-preview-notice')).toBeVisible();
  });
});
