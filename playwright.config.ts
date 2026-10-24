import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * E2E configuration (docs/ARCHITECTURE.md §13).
 *
 * Authentication note (§13.1): every critical journey begins with sign-in, and
 * real SMS cannot be received in CI. Journeys that need an authenticated user
 * must run against the Firebase Auth Emulator via FIREBASE_AUTH_EMULATOR_HOST.
 * TASK 001 only ships an unauthenticated smoke test, so no emulator is required
 * yet — the wiring lands with TASK 003.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Mobile is the primary customer surface (master spec §24), so it is a
    // first-class E2E target rather than an afterthought.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],

  // Reuse an already-running dev server locally; start one in CI.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
