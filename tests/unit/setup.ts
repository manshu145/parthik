/**
 * Unit test setup.
 *
 * Two jobs:
 *
 *  1. `reflect-metadata` polyfill, required by @peculiar/x509 (via tsyringe),
 *     which is used to mint real self-signed certificates for the Firebase token
 *     verifier tests.
 *
 *  2. Environment isolation. Vitest shares `process.env` across test files, so a
 *     test that deliberately sets an invalid value (to assert validation) would
 *     otherwise leak it into unrelated files and cause confusing failures. Each
 *     test starts from a known baseline instead.
 */
import 'reflect-metadata';
import { beforeEach } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/config/env';

/** Captured once, before any test mutates the environment. */
const baselineEnv = Object.freeze({ ...process.env });

/** Deterministic values so tests never depend on the developer's shell. */
const testDefaults: Record<string, string> = {
  NODE_ENV: 'test',
  APP_ENV: 'development',
  LOG_LEVEL: 'error',
  PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
};

beforeEach(() => {
  // Remove anything a previous test added.
  for (const key of Object.keys(process.env)) {
    if (!(key in baselineEnv)) delete process.env[key];
  }

  // Restore baseline values.
  for (const [key, value] of Object.entries(baselineEnv)) {
    if (value !== undefined) process.env[key] = value;
  }

  // Apply deterministic test defaults.
  Object.assign(process.env, testDefaults);

  resetEnvCacheForTests();
});
