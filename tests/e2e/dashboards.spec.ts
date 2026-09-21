import { expect, test } from '@playwright/test';
import {
  ADMIN_DETAIL_ROUTES,
  DRIVER_DETAIL_ROUTES,
  DRIVER_NAV_ITEMS,
  VENDOR_DETAIL_ROUTES,
  VENDOR_NAV_ITEMS,
  adminNavItems,
} from '@/lib/navigation/dashboard-nav';
import { signInAs, signOut } from './helpers/auth';

/**
 * Vendor, driver and admin surface E2E tests.
 *
 * Driven by the SAME manifest the sidebar and the page files come from, so a route
 * cannot exist in navigation without a page behind it — a broken dashboard link is
 * the kind of thing a customer finds before we do.
 *
 * Every route here is GATED. Each block signs in as the persona that surface belongs
 * to, via the development session endpoint, which issues a real session and leaves every
 * permission check running (tests/e2e/helpers/auth.ts).
 *
 * `access control` below asserts the other half, which matters more: anonymous visitors
 * are redirected, the wrong role is redirected, and an under-privileged admin is denied
 * the pages its permissions exclude.
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
      const persona = path.startsWith('/vendor')
        ? 'vendor'
        : path.startsWith('/driver')
          ? 'driver'
          : 'admin';
      await signInAs(page, persona);

      const response = await page.goto(path);

      expect(response?.status(), `${path} should render`).toBe(200);
      // Proves the layout mounted, not just that something returned 200.
      await expect(page.getByTestId('dashboard-header')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }
});

test.describe('vendor surface', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'vendor');
  });

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
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'driver');
  });

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
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'admin');
  });

  test('groups navigation into sections', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin');

    const sidebar = page.getByTestId('dashboard-sidebar');
    // A flat 45-item sidebar is unusable, so sections are load-bearing.
    await expect(sidebar.getByRole('heading', { level: 2 }).first()).toBeVisible();
    await expect(sidebar.getByTestId('dashboard-nav-item')).toHaveCount(adminNavItems().length);
  });

  test('renders a standard permission-gated page', async ({ page }) => {
    await page.goto('/admin/coupons');

    await expect(page.getByTestId('dashboard-header')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('renders the elevated-permission page', async ({ page }) => {
    await page.goto('/admin/settings/payments');

    await expect(page.getByTestId('dashboard-header')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('mobile navigation', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'admin');
  });

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
  /**
   * Signed in PER TEST rather than in a shared beforeEach, because each surface needs
   * its own persona. Signing all three in as an admin sends /hi/vendor and /hi/driver
   * straight to /admin — which is the gate working correctly, and which is exactly how
   * this block first failed.
   */
  test('renders the admin surface in Hindi', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/hi/admin');

    await expect(page.getByTestId('dashboard-header')).toContainText('एडमिन');
    await expect(page.getByRole('heading', { level: 1, name: 'डैशबोर्ड' })).toBeVisible();
  });

  test('renders the vendor surface in Hindi', async ({ page }) => {
    await signInAs(page, 'vendor');
    await page.goto('/hi/vendor');

    await expect(page.getByTestId('dashboard-header')).toContainText('विक्रेता');
  });

  test('renders the driver surface in Hindi', async ({ page }) => {
    await signInAs(page, 'driver');
    await page.goto('/hi/driver');

    await expect(page.getByTestId('dashboard-header')).toContainText('ड्राइवर');
  });
});

test.describe('access control', () => {
  test('every dashboard route is noindex', async ({ page }) => {
    await signInAs(page, 'admin');

    for (const path of ['/vendor', '/driver', '/admin', '/admin/audit-logs']) {
      await page.goto(path);
      const robots = await page.locator('meta[name="robots"]').first().getAttribute('content');
      expect(robots, `${path} must be noindex`).toContain('noindex');
    }
  });

  test.describe('anonymous visitors', () => {
    // The regression guard for the bypass that used to leave all 83 privileged routes
    // reachable by anyone outside production.
    for (const path of [
      '/admin',
      '/admin/orders',
      '/vendor',
      '/vendor/orders',
      '/driver',
      '/driver/cash',
      '/account',
      '/checkout',
    ]) {
      test(`are redirected to sign in from ${path}`, async ({ page }) => {
        const response = await page.goto(path, { waitUntil: 'domcontentloaded' });

        expect(response?.url()).toContain('/login');
        // The destination is preserved so sign-in resumes where they were going.
        expect(response?.url()).toContain('next=');
      });
    }

    test('are redirected to the Hindi login page from a Hindi route', async ({ page }) => {
      const response = await page.goto('/hi/admin', { waitUntil: 'domcontentloaded' });

      expect(response?.url()).toContain('/hi/login');
    });

    test('cannot get in by inventing a session cookie', async ({ page }) => {
      // The old gate checked only that a cookie of this NAME existed. Setting one by
      // hand was enough, which is precisely what this asserts is no longer true.
      await page.context().addCookies([
        {
          name: 'parthik_session',
          value: 'not-a-real-signed-token',
          domain: '127.0.0.1',
          path: '/',
        },
      ]);

      const response = await page.goto('/admin', { waitUntil: 'domcontentloaded' });

      expect(response?.url()).toContain('/login');
    });
  });

  test.describe('wrong surface', () => {
    test('a vendor is sent to their own dashboard from /admin', async ({ page }) => {
      await signInAs(page, 'vendor');

      // Not to sign-in: they ARE signed in, so a login page would be a loop.
      await page.goto('/admin', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/vendor$/);
    });

    test('a driver is sent to their own dashboard from /vendor', async ({ page }) => {
      await signInAs(page, 'driver');

      await page.goto('/vendor', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/driver$/);
    });

    test('a plain customer is sent to the shop from /admin', async ({ page }) => {
      await signInAs(page, 'customer');

      await page.goto('/admin', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/$/);
    });
  });

  test.describe('per-page permissions', () => {
    /**
     * ADMIN_SUPPORT reaches the admin surface but holds only 10 of the 59 permissions.
     * This is the block that proves the permission engine DENIES — signing in as
     * SUPER_ADMIN everywhere would never exercise that half.
     */
    const ALLOWED = [
      '/admin',
      '/admin/orders',
      '/admin/customers',
      '/admin/support',
      '/admin/delivery',
    ];
    const DENIED = [
      '/admin/roles',
      '/admin/settings/payments',
      '/admin/coupons',
      '/admin/audit-logs',
      '/admin/payouts',
      '/admin/cash/deposits',
    ];

    for (const path of ALLOWED) {
      test(`support reaches ${path}`, async ({ page }) => {
        await signInAs(page, 'support');
        await page.goto(path);

        await expect(page.getByTestId('dashboard-header')).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      });
    }

    for (const path of DENIED) {
      test(`support is denied ${path}`, async ({ page }) => {
        await signInAs(page, 'support');
        await page.goto(path);

        await expect(page.getByTestId('access-forbidden')).toBeVisible();
        // The page content must not render at all, not merely be hidden.
        await expect(page.getByTestId('dashboard-pending')).toHaveCount(0);
      });

      test(`a super admin reaches ${path}`, async ({ page }) => {
        // The control: the same page is reachable with the permission, so the denial
        // above is about permissions and not a broken route.
        await signInAs(page, 'admin');
        await page.goto(path);

        await expect(page.getByTestId('dashboard-header')).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      });
    }

    test('a denial offers no retry, because retrying cannot succeed', async ({ page }) => {
      await signInAs(page, 'support');
      await page.goto('/admin/roles');

      await expect(page.getByTestId('access-forbidden')).toBeVisible();
      await expect(page.getByRole('button', { name: /try again/i })).toHaveCount(0);
    });
  });

  test('signing out ends access immediately', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.goto('/admin');
    await expect(page.getByTestId('dashboard-header')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await signOut(page);

    const response = await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    expect(response?.url()).toContain('/login');
  });

  test('states plainly that development sign-in is enabled', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.goto('/admin');

    // Nobody should mistake a demo persona for their own privileges, or a development
    // build for a real one.
    await expect(page.getByTestId('dashboard-preview-notice')).toBeVisible();
  });
});
