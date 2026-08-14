import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // No React plugin: Vite's esbuild already transforms TSX using the `jsx`
  // setting from tsconfig, and tests need no Fast Refresh.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    // Node by default. Component tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock, so pure-logic tests stay fast and are
    // not given browser globals they should not rely on.
    environment: 'node',
    globals: false,
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    setupFiles: ['./tests/unit/setup.ts'],
    // E2E lives in tests/e2e and is run by Playwright, not Vitest.
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**', '.open-next/**'],
    reporters: 'default',
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['lib/**/*.ts', 'components/**/*.tsx'],
      exclude: ['lib/**/*.d.ts'],
    },
  },
});
