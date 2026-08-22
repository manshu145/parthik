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
      /**
       * `modules/**` is included deliberately.
       *
       * It was previously omitted, which meant the pricing, coupon, permission and
       * session logic — the code the documentation names as the most important to test
       * near-exhaustively (docs/ARCHITECTURE.md §13) — reported no coverage at all.
       * Excluding the business layer from the coverage report makes the report describe
       * the least risky part of the codebase.
       */
      include: ['lib/**/*.ts', 'components/**/*.tsx', 'modules/**/*.ts'],
      exclude: [
        'lib/**/*.d.ts',
        // Fixture repositories and composition roots are test scaffolding and wiring,
        // not logic worth a coverage target.
        'modules/**/*-memory.repository.ts',
        'modules/**/index.ts',
      ],
    },
  },
});
