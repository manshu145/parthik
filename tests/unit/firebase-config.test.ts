import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigurationError } from '@/lib/errors';
import { resetEnvCacheForTests } from '@/lib/config/env';
import {
  getFirebaseClientConfigOrNull,
  getFirebaseServerConfigOrNull,
  isFirebaseClientConfigured,
  isFirebaseServerConfigured,
  requireFirebaseClientConfig,
  requireFirebaseProjectId,
  requireFirebaseServerConfig,
} from '@/lib/firebase/config';

/**
 * TASK 001 verification requirement 8: "Verify Firebase configuration fails
 * safely when credentials are missing."
 *
 * Failing safely means two specific things, both asserted here:
 *   - absence is reported, never thrown, so the app still boots and renders
 *   - actual USE without credentials raises a typed ConfigurationError (503),
 *     not a TypeError from reading a property of undefined
 */

const FIREBASE_KEYS = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_SERVICE_ACCOUNT_EMAIL',
  'FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
];

const snapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of FIREBASE_KEYS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
  resetEnvCacheForTests();
});

afterEach(() => {
  for (const key of FIREBASE_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
  resetEnvCacheForTests();
});

describe('Firebase configuration — missing credentials', () => {
  it('reports the client as unconfigured without throwing', () => {
    expect(isFirebaseClientConfigured()).toBe(false);
    expect(getFirebaseClientConfigOrNull()).toBeNull();
  });

  it('reports the server as unconfigured without throwing', () => {
    expect(isFirebaseServerConfigured()).toBe(false);
    expect(getFirebaseServerConfigOrNull()).toBeNull();
  });

  it('throws a typed ConfigurationError when the client config is actually used', () => {
    expect(() => requireFirebaseClientConfig()).toThrow(ConfigurationError);
  });

  it('throws a typed ConfigurationError when the server config is actually used', () => {
    expect(() => requireFirebaseServerConfig()).toThrow(ConfigurationError);
  });

  it('throws a typed ConfigurationError when a project id is required', () => {
    expect(() => requireFirebaseProjectId()).toThrow(ConfigurationError);
  });

  it('maps to 503 and hides internal detail from users', () => {
    try {
      requireFirebaseClientConfig();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const configError = error as ConfigurationError;

      expect(configError.status).toBe(503);
      expect(configError.code).toBe('CONFIGURATION_ERROR');
      // The public message must not name environment variables or internals.
      expect(configError.publicMessage).not.toMatch(/FIREBASE|NEXT_PUBLIC/i);
      // The internal message should be actionable for a developer.
      expect(configError.message).toMatch(/NEXT_PUBLIC_FIREBASE/);
    }
  });
});

describe('Firebase configuration — partial credentials', () => {
  it('treats a partially configured client as unconfigured rather than half-working', () => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-key';
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'x.firebaseapp.com';
    // projectId, appId and senderId deliberately absent.
    resetEnvCacheForTests();

    expect(isFirebaseClientConfigured()).toBe(false);
  });

  it('allows token verification with only a project id, without a service account', () => {
    // Verifying tokens needs the project id; only privileged REST calls need the
    // service account. Conflating them would block sign-in unnecessarily.
    process.env.FIREBASE_PROJECT_ID = 'parthik-test';
    resetEnvCacheForTests();

    expect(requireFirebaseProjectId()).toBe('parthik-test');
    expect(isFirebaseServerConfigured()).toBe(false);
  });
});

describe('Firebase configuration — fully configured', () => {
  it('resolves the client config', () => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-key';
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'x.firebaseapp.com';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'parthik-test';
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID = '1:2:web:3';
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '123456';
    resetEnvCacheForTests();

    const config = requireFirebaseClientConfig();
    expect(config.projectId).toBe('parthik-test');
    expect(isFirebaseClientConfigured()).toBe(true);
  });

  it('normalises an escaped-newline private key', () => {
    process.env.FIREBASE_PROJECT_ID = 'parthik-test';
    process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL = 'sa@parthik-test.iam.gserviceaccount.com';
    process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\\nMIIabc\\n-----END PRIVATE KEY-----\\n';
    resetEnvCacheForTests();

    const config = requireFirebaseServerConfig();
    // Escaped \n in a shell-provided env var must become real newlines, or the
    // PEM import fails at runtime with a confusing error.
    expect(config.privateKey).toContain('\n');
    expect(config.privateKey).not.toContain('\\n');
  });
});
