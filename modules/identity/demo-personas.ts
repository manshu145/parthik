import type { Locale } from '@/i18n/routing';
import type { RoleKey } from './permissions';

/**
 * The canonical demo identities, shared by every consumer.
 *
 * WHY THIS FILE EXISTS. There were two independent lists: `DEMO_USERS` in the in-memory
 * identity repository (`demo-admin-uid`, …) and `DEV_USERS` in the database seed
 * (`dev-firebase-uid-admin`, …). They described the same people under different uids, so
 * `POST /api/v1/auth/dev-session` worked against the in-memory backend and returned
 * "demo user does not exist" against a real database — the divergence only surfaced once
 * a database existed to try it on.
 *
 * Same reasoning as `permissions.ts`: one declaration, several consumers, and a test
 * that proves they still agree.
 *
 * Consumed by:
 *   - `identity-memory.repository.ts` — seeds the in-memory store
 *   - `db/seed/dev-data.ts`           — seeds `users` and their role grants
 *   - `app/api/v1/auth/dev-session`   — maps a requested role to a persona
 */

/** Reserved test range, so a demo number can never collide with a real one. */
const DEMO_PHONE_PREFIX = '+91555000';

/**
 * Where a role grant applies.
 *
 * `DEMO_VENDOR` is resolved differently on each side — the seed looks up the vendor it
 * just inserted, the in-memory store uses a deterministic fixture id — so it is named
 * symbolically here rather than hardcoding an id that only one consumer could honour.
 */
export type DemoScope = 'GLOBAL' | 'DEMO_VENDOR';

export interface DemoPersona {
  /** Stable key used by the dev-session endpoint and by seed cross-references. */
  ref: 'customer' | 'vendor' | 'driver' | 'admin' | 'support';
  firebaseUid: string;
  phone: string;
  fullName: string;
  preferredLocale: Locale;
  /** Every persona also holds CUSTOMER, because everyone can shop. */
  roles: ReadonlyArray<{ roleKey: RoleKey; scope: DemoScope }>;
}

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    ref: 'customer',
    firebaseUid: 'dev-firebase-uid-customer',
    phone: `${DEMO_PHONE_PREFIX}004`,
    fullName: 'Dev Customer',
    preferredLocale: 'en',
    roles: [{ roleKey: 'CUSTOMER', scope: 'GLOBAL' }],
  },
  {
    ref: 'vendor',
    firebaseUid: 'dev-firebase-uid-vendor',
    phone: `${DEMO_PHONE_PREFIX}002`,
    fullName: 'Dev Vendor Owner',
    preferredLocale: 'en',
    roles: [
      { roleKey: 'CUSTOMER', scope: 'GLOBAL' },
      // Vendor-scoped, so the tenant-containment rules in identity.policy.ts are
      // actually exercised rather than trivially satisfied by a GLOBAL grant.
      { roleKey: 'VENDOR_OWNER', scope: 'DEMO_VENDOR' },
    ],
  },
  {
    ref: 'driver',
    firebaseUid: 'dev-firebase-uid-driver',
    phone: `${DEMO_PHONE_PREFIX}003`,
    fullName: 'Dev Driver',
    // Hindi by default, so the driver surface is exercised in both locales.
    preferredLocale: 'hi',
    roles: [
      { roleKey: 'CUSTOMER', scope: 'GLOBAL' },
      { roleKey: 'DRIVER', scope: 'GLOBAL' },
    ],
  },
  {
    ref: 'admin',
    firebaseUid: 'dev-firebase-uid-admin',
    phone: `${DEMO_PHONE_PREFIX}001`,
    fullName: 'Dev Super Admin',
    preferredLocale: 'en',
    roles: [
      { roleKey: 'CUSTOMER', scope: 'GLOBAL' },
      { roleKey: 'SUPER_ADMIN', scope: 'GLOBAL' },
    ],
  },
  {
    /**
     * DELIBERATELY UNDER-PRIVILEGED. ADMIN_SUPPORT reaches the admin surface but holds
     * only 10 of the 59 permissions — no refunds, no settings, no RBAC.
     *
     * Without a persona like this every test signs in as SUPER_ADMIN, and the permission
     * checks are never observed DENYING anything — which is the half of authorization
     * that actually matters.
     */
    ref: 'support',
    firebaseUid: 'dev-firebase-uid-support',
    phone: `${DEMO_PHONE_PREFIX}005`,
    fullName: 'Dev Support Agent',
    preferredLocale: 'en',
    roles: [
      { roleKey: 'CUSTOMER', scope: 'GLOBAL' },
      { roleKey: 'ADMIN_SUPPORT', scope: 'GLOBAL' },
    ],
  },
];

export type DemoPersonaRef = DemoPersona['ref'];

const BY_REF = new Map(DEMO_PERSONAS.map((persona) => [persona.ref, persona]));

export function demoPersona(ref: DemoPersonaRef): DemoPersona {
  const persona = BY_REF.get(ref);
  if (!persona) throw new Error(`Unknown demo persona "${ref}".`);
  return persona;
}

export const DEMO_PERSONA_REFS = DEMO_PERSONAS.map((persona) => persona.ref);
