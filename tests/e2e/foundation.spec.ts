import { expect, test } from '@playwright/test';

/**
 * Foundation smoke tests.
 *
 * Deliberately unauthenticated. The four critical journeys from master spec §29
 * all begin with sign-in, and per docs/ARCHITECTURE.md §13.1 those require the
 * Firebase Auth Emulator — they arrive with TASK 003 rather than being faked now.
 *
 * What this suite proves today: the app boots, both locales render, SEO surfaces
 * respond, health endpoints work, and security headers are applied.
 */

test.describe('foundation', () => {
  test('renders the English home page', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'en-IN');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('renders the Hindi home page under /hi', async ({ page }) => {
    await page.goto('/hi');

    await expect(page.locator('html')).toHaveAttribute('lang', 'hi-IN');
    // Devanagari content must actually be present, not English fallback.
    await expect(page.locator('body')).toContainText(/[\u0900-\u097F]/);
  });

  test('switches locale while preserving the page', async ({ page }) => {
    await page.goto('/');
    // Scoped to the FOOTER switcher, which is the one present at every
    // breakpoint. The header switcher is intentionally desktop-only, so mobile
    // users rely on this one.
    await page.getByTestId('site-footer').getByRole('button', { name: 'हिन्दी' }).click();

    await expect(page).toHaveURL(/\/hi(\/)?$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi-IN');
  });

  test('returns a branded 404 for an unknown path', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
  });

  test('404s an unsupported locale rather than silently serving English', async ({ page }) => {
    const response = await page.goto('/fr');
    expect(response?.status()).toBe(404);
  });

  test('liveness endpoint responds', async ({ request }) => {
    const response = await request.get('/api/v1/health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
  });

  test('deep health reports unconfigured providers without failing', async ({ request }) => {
    const response = await request.get('/api/v1/health/deep');
    // 200 even with no credentials: optional providers are not required.
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.components.length).toBeGreaterThan(0);

    const names = body.data.components.map((c: { name: string }) => c.name);
    expect(names).toContain('firebase-auth-client');
    expect(names).toContain('google-maps');
  });

  test('applies security headers', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    // CSP is report-only until observed against real sign-in/checkout traffic.
    expect(headers['content-security-policy-report-only']).toBeTruthy();
    expect(headers['x-request-id']).toBeTruthy();
  });

  test('serves robots.txt and sitemap.xml', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    // Bilingual sitemap must advertise hreflang alternates.
    expect(await sitemap.text()).toContain('hreflang');
  });

  test('serves the PWA manifest', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);

    const manifest = await response.json();
    expect(manifest.name).toBe('Parthik');
  });

  test('redirects an unauthenticated visitor away from a private surface', async ({ page }) => {
    await page.goto('/account');
    // No session cookie -> coarse middleware gate sends us to login.
    await expect(page).toHaveURL(/\/login/);
  });
});
