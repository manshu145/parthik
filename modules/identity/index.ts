import { getServerEnv } from '@/lib/config/env';
import { canIssueSessions } from '@/lib/auth/session-token';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { isFirebaseClientConfigured, getFirebaseProjectIdOrNull } from '@/lib/firebase/config';
import { logger } from '@/lib/logger';
import { DrizzleIdentityRepository } from './identity.repository';
import { InMemoryIdentityRepository, inMemoryDemoPhones } from './identity-memory.repository';
import type { IdentityRepository } from './identity.repository.types';
import { IdentityService } from './identity.service';

/**
 * Identity module composition root.
 *
 * Route handlers call `getIdentityService()` and never construct a repository, so the
 * backend-selection rule lives in exactly one place — the same pattern as the other
 * modules.
 */

export type IdentityBackend = 'postgres' | 'memory';

let warnedAboutMemory = false;

/**
 * Chooses the repository implementation.
 *
 * In PRODUCTION the in-memory repository is NEVER used, and the reason is stronger
 * here than for catalogue data. Sessions in process memory would be lost on every
 * deploy and would not be shared between isolates, so users would be signed out at
 * random — and worse, `login_attempts` would reset constantly, disabling the
 * brute-force throttle. A database error is the correct failure.
 */
export function resolveIdentityBackend(): IdentityBackend {
  const env = getServerEnv();

  if (isDatabaseConfigured()) return 'postgres';
  if (env.APP_ENV === 'production') return 'postgres';

  if (!warnedAboutMemory) {
    warnedAboutMemory = true;
    logger.info('Using the in-memory identity repository — no database configured', {
      appEnv: env.APP_ENV,
    });
  }

  return 'memory';
}

async function createIdentityRepository(): Promise<IdentityRepository> {
  if (resolveIdentityBackend() === 'memory') {
    return new InMemoryIdentityRepository();
  }

  // Throws ConfigurationError (503) when unreachable, which is the correct
  // production failure.
  const db = await getDb();
  return new DrizzleIdentityRepository({ db });
}

export async function getIdentityService(): Promise<IdentityService> {
  const repository = await createIdentityRepository();
  return new IdentityService({ repository });
}

/**
 * Whether sign-in can work at all in this environment.
 *
 * Reported as three independent facts rather than one boolean because they fail for
 * different reasons and the login page must tell the user WHICH is missing. "Sign-in
 * unavailable" with no explanation is the kind of message that costs an hour of
 * someone's afternoon.
 */
export function describeAuthReadiness(): {
  ready: boolean;
  firebaseConfigured: boolean;
  authSecretConfigured: boolean;
  databaseConfigured: boolean;
  backend: IdentityBackend;
  missing: string[];
} {
  const firebaseConfigured = isFirebaseClientConfigured() && getFirebaseProjectIdOrNull() !== null;
  const authSecretConfigured = canIssueSessions();
  const databaseConfigured = isDatabaseConfigured();

  const missing: string[] = [];
  if (!firebaseConfigured) missing.push('NEXT_PUBLIC_FIREBASE_*');
  if (!authSecretConfigured) missing.push('AUTH_SECRET');

  return {
    // The database is deliberately absent from this condition: the in-memory
    // repository is a legitimate development backend, so sign-in works without a
    // database outside production.
    ready: firebaseConfigured && authSecretConfigured,
    firebaseConfigured,
    authSecretConfigured,
    databaseConfigured,
    backend: resolveIdentityBackend(),
    missing,
  };
}

/** Backend status for development diagnostics. */
export function describeIdentityBackend(): {
  backend: IdentityBackend;
  databaseConfigured: boolean;
  demoPhones: string[] | null;
} {
  const backend = resolveIdentityBackend();

  return {
    backend,
    databaseConfigured: isDatabaseConfigured(),
    // Only ever the fixture's own numbers; real user phone numbers are never
    // diagnostics material.
    demoPhones: backend === 'memory' ? inMemoryDemoPhones() : null,
  };
}

/** Test-only: clears the one-time log guard. */
export function resetIdentityBackendWarningForTests(): void {
  warnedAboutMemory = false;
}

export { IdentityService } from './identity.service';
export { InMemoryIdentityRepository, DEMO_USERS } from './identity-memory.repository';
export {
  DrizzleIdentityRepository,
  createIdentityRepository as createDrizzleIdentityRepository,
} from './identity.repository';
export {
  buildActor,
  can,
  landingSurfaceForRoles,
  ownsResource,
  requireActor,
  requirePermission,
  roleKeysFor,
  sessionAudienceForRoles,
  surfacesForRoles,
  vendorScopeIdsFor,
  type Actor,
  type ResourceScope,
} from './identity.policy';
export {
  isPermissionKey,
  isRoleKey,
  permissionsForRole,
  permissionsForRoles,
  PERMISSION_KEYS,
  ROLE_KEYS,
  ROLE_SURFACES,
  type PermissionKey,
  type RoleKey,
} from './permissions';
export { createSessionSchema, revokeSessionSchema } from './identity.schema';
export type {
  IdentityRepository,
  RoleGrant,
  SessionWithUser,
  UserRecord,
} from './identity.repository.types';
export type { ExchangeResult, SessionContext } from './identity.service';
