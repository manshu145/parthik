import { expect, test, type Page } from '@playwright/test';

/**
 * Customer shell E2E smoke tests.
 *
 * Covers what unit tests cannot: real routing, the responsive split between the
 * bottom bar and the desktop header, locale-prefixed navigation, and the
 * middleware auth gate.
 *
 * Still unauthenticated — sign-in requires the Firebase Auth Emulator
 * (docs/ARCHITECTURE.md §13.1), which arrives with the auth task.
 */

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

/** Both locales, so no surface is only ever verified in English. */
const LOCALES = [
  { code: 'en', prefix: '', appName: 'Parthik', home: 'Home', cart: 'Cart' },
  { code: 'hi', prefix: '/hi', appName: 'पार्थिक', home: 'होम', cart: 'कार्ट' },
] as const;

async function gotoWithViewport(page: Page, path: string, viewport: typeof DESKTOP) {
  await page.setViewportSize(viewport);
  await page.goto(path);
}

test.describe('shell renders in both locales', () => {
  for (const locale of LOCALES) {
    test(`[${locale.code}] header, main and footer are present`, async ({ page }) => {
      await page.goto(`${locale.prefix}/`);

      await expect(page.getByTestId('site-header')).toBeVisible();
      await expect(page.getByTestId('site-footer')).toBeAttached();
      // Exactly one main landmark, which the skip link targets.
      await expect(page.locator('main#main')).toHaveCount(1);
    });

    test(`[${locale.code}] declares the correct html lang`, async ({ page }) => {
      await page.goto(`${locale.prefix}/`);
      await expect(page.locator('html')).toHaveAttribute(
        'lang',
        locale.code === 'hi' ? 'hi-IN' : 'en-IN'
      );
    });

    test(`[${locale.code}] renders localised navigation labels`, async ({ page }) => {
      await gotoWithViewport(page, `${locale.prefix}/`, MOBILE);

      const nav = page.getByTestId('bottom-nav');
      await expect(nav.getByText(locale.home, { exact: true })).toBeVisible();
      await expect(nav.getByText(locale.cart, { exact: true })).toBeVisible();
    });
  }
});

test.describe('responsive navigation', () => {
  test('mobile shows the bottom bar with five items', async ({ page }) => {
    await gotoWithViewport(page, '/', MOBILE);

    const nav = page.getByTestId('bottom-nav');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link')).toHaveCount(5);
  });

  test('desktop hides the bottom bar and shows header navigation', async ({ page }) => {
    await gotoWithViewport(page, '/', DESKTOP);

    // Present in the DOM but hidden by `md:hidden`.
    await expect(page.getByTestId('bottom-nav')).toBeHidden();
    await expect(page.getByRole('navigation', { name: /secondary navigation/i })).toBeVisible();
  });

  test('search is reachable at both breakpoints', async ({ page }) => {
    await gotoWithViewport(page, '/', MOBILE);
    await expect(page.getByRole('combobox').first()).toBeVisible();

    await gotoWithViewport(page, '/', DESKTOP);
    await expect(page.getByRole('combobox').first()).toBeVisible();
  });
});

test.describe('navigation between real routes', () => {
  test('bottom nav reaches categories, offers and cart', async ({ page }) => {
    await gotoWithViewport(page, '/', MOBILE);
    const nav = page.getByTestId('bottom-nav');

    await nav.getByRole('link', { name: 'Categories' }).click();
    await expect(page).toHaveURL(/\/categories$/);
    // The active tab must be marked for assistive tech, not by colour alone.
    await expect(nav.locator('[data-nav-id="categories"]')).toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', { name: 'Offers' }).click();
    await expect(page).toHaveURL(/\/offers$/);

    await nav.getByRole('link', { name: 'Cart' }).click();
    await expect(page).toHaveURL(/\/cart$/);
  });

  test('Hindi navigation keeps the /hi prefix', async ({ page }) => {
    await gotoWithViewport(page, '/hi', MOBILE);

    await page.getByTestId('bottom-nav').getByText('श्रेणियाँ', { exact: true }).click();
    // Losing the prefix here would silently drop a Hindi user into English.
    await expect(page).toHaveURL(/\/hi\/categories$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi-IN');
  });

  test('category detail keeps the Categories tab active', async ({ page }) => {
    await gotoWithViewport(page, '/category/fruits-vegetables', MOBILE);

    await expect(
      page.getByTestId('bottom-nav').locator('[data-nav-id="categories"]')
    ).toHaveAttribute('aria-current', 'page');
  });

  test('search submits to the search route', async ({ page }) => {
    await gotoWithViewport(page, '/', DESKTOP);

    await page.getByRole('combobox').first().fill('atta');
    await page.getByRole('combobox').first().press('Enter');

    await expect(page).toHaveURL(/\/search\?q=atta/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('footer links reach the marketing routes', async ({ page }) => {
    await gotoWithViewport(page, '/', DESKTOP);

    const footer = page.getByTestId('site-footer');
    await expect(footer.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      '/privacy'
    );
    await expect(footer.getByRole('link', { name: 'Become a vendor' })).toHaveAttribute(
      'href',
      '/vendor-registration'
    );
  });
});

test.describe('cart drawer', () => {
  test('opens, traps focus and closes with Escape', async ({ page }) => {
    await gotoWithViewport(page, '/', DESKTOP);

    await page.getByTestId('cart-trigger').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Your cart');
    await expect(dialog).toContainText('Your cart is empty');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('opens in Hindi with translated copy', async ({ page }) => {
    await gotoWithViewport(page, '/hi', DESKTOP);

    await page.getByTestId('cart-trigger').click();
    await expect(page.getByRole('dialog')).toContainText('आपकी कार्ट');
  });
});

test.describe('location selector', () => {
  test('opens the bottom sheet with working controls', async ({ page }) => {
    await gotoWithViewport(page, '/', MOBILE);

    await page.getByTestId('location-trigger').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Choose delivery location');
    // Wired up in TASK 005; the full flow is covered in tests/e2e/location.spec.ts.
    await expect(dialog.getByTestId('location-detect')).toBeEnabled();
    await expect(dialog.getByTestId('location-pincode')).toBeVisible();
  });
});

test.describe('locale switching', () => {
  test('switches language while preserving the current page', async ({ page }) => {
    await gotoWithViewport(page, '/categories', DESKTOP);

    await page.getByRole('button', { name: 'हिन्दी' }).first().click();

    // Must stay on categories rather than bouncing to the homepage.
    await expect(page).toHaveURL(/\/hi\/categories$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi-IN');
  });
});

test.describe('accessibility basics', () => {
  test('skip link is the first tab stop and moves focus to main', async ({ page }) => {
    await gotoWithViewport(page, '/', DESKTOP);

    // Wait for the shell to be interactive before pressing Tab. Without this the
    // keypress can land while the document is still settling and focus goes
    // nowhere, which made this test flake intermittently in both projects.
    await expect(page.getByTestId('site-header')).toBeVisible();
    await expect(page.getByTestId('skip-link')).toBeAttached();

    await page.keyboard.press('Tab');
    const skip = page.getByTestId('skip-link');
    await expect(skip).toBeFocused();

    await skip.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('every page has exactly one h1', async ({ page }) => {
    for (const path of ['/', '/categories', '/offers', '/cart', '/hi', '/hi/categories']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }), `${path} h1 count`).toHaveCount(1);
    }
  });

  test('navigation landmarks are named', async ({ page }) => {
    await gotoWithViewport(page, '/', MOBILE);

    // An unnamed nav region is unusable for landmark navigation.
    await expect(page.getByRole('navigation', { name: /primary navigation/i })).toBeVisible();
  });
});

test.describe('private route gating', () => {
  test('unauthenticated /account redirects to login', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
  });

  test('unauthenticated /favorites redirects to login', async ({ page }) => {
    await page.goto('/favorites');
    await expect(page).toHaveURL(/\/login/);
  });

  test('Hindi private route redirects to the Hindi login', async ({ page }) => {
    await page.goto('/hi/account');
    await expect(page).toHaveURL(/\/hi\/login/);
  });

  test('cart is reachable without signing in', async ({ page }) => {
    // GUEST-OK per docs/ROUTES.md §5.
    await page.goto('/cart');
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('PWA and offline surfaces', () => {
  test('serves the offline page in both locales', async ({ page }) => {
    await page.goto('/offline');
    await expect(page.getByTestId('offline-page')).toBeVisible();

    await page.goto('/hi/offline');
    await expect(page.getByTestId('offline-page')).toContainText('ऑफ़लाइन');
  });

  test('serves the service worker with a JavaScript content type', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('javascript');
  });

  test('service worker never caches private or API routes', async ({ request }) => {
    const source = await (await request.get('/sw.js')).text();

    // Caching any of these could serve one user's data to another.
    for (const guarded of ['api', 'account', 'checkout', 'orders', 'cart']) {
      expect(source).toContain(guarded);
    }
  });

  test('shows an offline banner when the network drops', async ({ page, context }) => {
    await gotoWithViewport(page, '/', MOBILE);

    await context.setOffline(true);
    // The banner reacts to the browser offline event.
    await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 10_000 });

    await context.setOffline(false);
    await expect(page.getByTestId('offline-banner')).toBeHidden({ timeout: 10_000 });
  });
});

test.describe('SEO safety', () => {
  test('private routes are noindex', async ({ page }) => {
    const response = await page.goto('/cart');
    expect(response?.headers()['x-robots-tag']).toContain('noindex');
  });

  test('sitemap lists only public routes', async ({ request }) => {
    const sitemap = await (await request.get('/sitemap.xml')).text();

    expect(sitemap).toContain('/categories');
    expect(sitemap).toContain('hreflang');
    // Private surfaces must never be advertised to crawlers.
    for (const privatePath of ['/account', '/cart', '/favorites', '/search']) {
      expect(sitemap).not.toContain(`<loc>${privatePath}`);
    }
  });
});
