import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// eslint-config-next 16 ships native flat configs, so no FlatCompat bridge is
// needed (and the bridge in fact fails on it).

/**
 * Architectural import boundaries from docs/ARCHITECTURE.md §5.1.
 *
 * These are not style rules. They are the mechanism that keeps business logic
 * out of the UI and keeps data access behind the repository layer, which is
 * what allows a module to be extracted into a separate API service later.
 */
const boundaries = [
  {
    // app/ composes; it must not reach past the service layer.
    files: ['app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/*/*.repository', '@/modules/*/*.repository'],
              message:
                'app/ must not import repositories directly. Go through the module service so business rules and permission checks cannot be bypassed.',
            },
            {
              group: ['@/db', '@/db/*', '**/db/schema*'],
              message: 'app/ must not access the database layer directly. Use a module service.',
            },
          ],
        },
      ],
    },
  },
  {
    // components/ stays presentational and reusable.
    files: ['components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules', '@/modules/*', '**/modules/*'],
              message:
                'components/ must not import business modules. Pass data in as props; keep components presentational.',
            },
            {
              group: ['@/db', '@/db/*'],
              message: 'components/ must never touch the database layer.',
            },
          ],
        },
      ],
    },
  },
  {
    // Cross-module access goes through services, never another module's tables.
    files: ['modules/**/*.{ts,tsx}'],
    ignores: ['modules/**/*.repository.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/db', '@/db/*'],
              message:
                'Only *.repository.ts files may import the database layer. This keeps data access to a single chokepoint.',
            },
          ],
        },
      ],
    },
  },
  {
    // A module must not reach into another module's repository.
    files: ['modules/**/*.repository.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/*.repository'],
              message:
                'A repository must not import another module’s repository. Cross-domain access goes through that module’s service.',
            },
          ],
        },
      ],
    },
  },
];

/**
 * Nothing outside lib/config may read process.env — all configuration is
 * validated once at a single boundary (docs/ARCHITECTURE.md §5.1, §15).
 */
const envAccess = {
  files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'modules/**/*.ts', 'lib/**/*.ts'],
  ignores: ['lib/config/**'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "MemberExpression[object.object.name='process'][object.property.name='env']",
        message:
          'Do not read process.env directly. Import validated config from @/lib/config/env instead.',
      },
      {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message:
          'Do not read process.env directly. Import validated config from @/lib/config/env instead.',
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      '.open-next/**',
      '.wrangler/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'types/cloudflare-env.d.ts',
      'public/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Strictness that matches the documented coding rules (master spec §28).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  ...boundaries,
  envAccess,
  {
    // Config files, tests and the logger legitimately need broader access.
    files: [
      '*.config.{ts,mjs,js}',
      'drizzle.config.ts',
      'next.config.ts',
      'tests/**/*.ts',
      'lib/logger/**/*.ts',
      'lib/observability/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
      'no-console': 'off',
    },
  },
  prettier
);
