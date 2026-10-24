import { expect, type Page } from '@playwright/test';

/**
 * Authenticating in E2E (docs/ARCHITECTURE.md §13.1).
 *
 * Every privileged journey begins with sign-in, and real SMS cannot be received in CI —
 * so without a deterministic way to authenticate, the whole authenticated suite would be
 * unimplementable.
 *
 * This posts to `POST /api/v1/auth/dev-session`, which mints a real session for a seeded
 * persona. It is 404 in production and 404 without an explicit `DEV_AUTH_ENABLED=true`,
 * and it exercises the PRODUCTION session and permission path rather than bypassing it —
 * so a test that passes here is evidence about the real authorization code, not about a
 * test-only shortcut.
 *
 * `page.request` shares the browser context's cookie jar, so the session cookie set by
 * the response is automatically sent by subsequent navigations.
 */

export type DemoRole = 'customer' | 'vendor' | 'driver' | 'admin' | 'support';

/** The persona each role maps to, for assertions about what they should reach. */
export const DEMO_ROLE_KEYS: Record<DemoRole, string[]> = {
  customer: ['CUSTOMER'],
  vendor: ['CUSTOMER', 'VENDOR_OWNER'],
  driver: ['CUSTOMER', 'DRIVER'],
  admin: ['CUSTOMER', 'SUPER_ADMIN'],
  // Deliberately under-privileged, so denials can be observed.
  support: ['CUSTOMER', 'ADMIN_SUPPORT'],
};

export async function signInAs(page: Page, role: DemoRole): Promise<void> {
  const response = await page.request.post('/api/v1/auth/dev-session', {
    data: { role },
  });

  // A 404 here means the endpoint is disabled — almost always a missing
  // DEV_AUTH_ENABLED in the harness. Saying so beats a cascade of redirect failures in
  // every downstream test.
  expect(
    response.status(),
    `dev-session sign-in failed for "${role}". Is DEV_AUTH_ENABLED=true and AUTH_SECRET set?`
  ).toBe(201);
}

/** Clears the session, for asserting anonymous behaviour inside a signed-in file. */
export async function signOut(page: Page): Promise<void> {
  await page.request.delete('/api/v1/auth/session');
  await page.context().clearCookies();
}
