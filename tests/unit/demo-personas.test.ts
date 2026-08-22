import { describe, expect, it } from 'vitest';
import { DEV_USERS } from '@/db/seed/dev-data';
import {
  DEMO_PERSONAS,
  DEMO_PERSONA_REFS,
  demoPersona,
  type DemoPersonaRef,
} from '@/modules/identity/demo-personas';
import { DEMO_USERS } from '@/modules/identity/identity-memory.repository';
import { isRoleKey, permissionsForRole } from '@/modules/identity/permissions';

/**
 * Demo persona parity.
 *
 * These identities are consumed in three places — the in-memory identity backend, the
 * database seed, and `POST /api/v1/auth/dev-session`. They used to be declared twice,
 * under different firebase uids, and the consequence was invisible until a database
 * existed: development sign-in worked against the in-memory backend and returned
 * "demo user does not exist" against real Postgres.
 *
 * So this file's job is not to check the data is pretty. It is to assert the three
 * consumers still describe the SAME people.
 */

describe('one declaration, three consumers', () => {
  it('gives the in-memory backend and the database seed identical firebase uids', () => {
    const memory = DEMO_USERS.map((user) => user.firebaseUid).sort();
    const seed = DEV_USERS.map((user) => user.firebaseUid).sort();
    const canonical = DEMO_PERSONAS.map((persona) => persona.firebaseUid).sort();

    expect(memory).toEqual(canonical);
    expect(seed).toEqual(canonical);
  });

  it('gives them identical phone numbers', () => {
    expect(DEMO_USERS.map((u) => u.phone).sort()).toEqual(DEV_USERS.map((u) => u.phone).sort());
  });

  it('gives them identical role sets', () => {
    for (const persona of DEMO_PERSONAS) {
      const memory = DEMO_USERS.find((u) => u.firebaseUid === persona.firebaseUid);
      const seed = DEV_USERS.find((u) => u.firebaseUid === persona.firebaseUid);

      expect(memory?.roles.map((r) => r.roleKey).sort()).toEqual(
        persona.roles.map((r) => r.roleKey).sort()
      );
      expect(seed?.roles.map((r) => r.roleKey).sort()).toEqual(
        persona.roles.map((r) => r.roleKey).sort()
      );
    }
  });

  it('exposes every persona ref that the dev-session endpoint accepts', () => {
    expect(DEMO_PERSONA_REFS.sort()).toEqual(
      ['admin', 'customer', 'driver', 'support', 'vendor'].sort()
    );
  });
});

describe('persona integrity', () => {
  it('uses only known role keys', () => {
    // A typo'd role would fail closed and grant nothing, so the persona would sign in and
    // then be unable to reach the surface it exists to demonstrate.
    for (const persona of DEMO_PERSONAS) {
      for (const grant of persona.roles) {
        expect(isRoleKey(grant.roleKey), `${persona.ref} → ${grant.roleKey}`).toBe(true);
      }
    }
  });

  it('gives every persona the CUSTOMER role, because everyone can shop', () => {
    for (const persona of DEMO_PERSONAS) {
      expect(persona.roles.map((r) => r.roleKey)).toContain('CUSTOMER');
    }
  });

  it('uses reserved test phone numbers only', () => {
    // +91555000xxx is a reserved range, so a demo number can never collide with a real
    // customer's — or, worse, receive a real notification.
    for (const persona of DEMO_PERSONAS) {
      expect(persona.phone).toMatch(/^\+91555000\d{3}$/);
    }
  });

  it('has unique refs, uids and phones', () => {
    const refs = DEMO_PERSONAS.map((p) => p.ref);
    const uids = DEMO_PERSONAS.map((p) => p.firebaseUid);
    const phones = DEMO_PERSONAS.map((p) => p.phone);

    expect(new Set(refs).size).toBe(refs.length);
    expect(new Set(uids).size).toBe(uids.length);
    expect(new Set(phones).size).toBe(phones.length);
  });

  it('scopes the vendor grant to a vendor rather than globally', () => {
    // A GLOBAL vendor grant would be the easy shortcut and would make the tenant
    // containment rules untestable — every scoped check would trivially pass.
    const vendor = demoPersona('vendor');
    const grant = vendor.roles.find((role) => role.roleKey === 'VENDOR_OWNER');

    expect(grant?.scope).toBe('DEMO_VENDOR');
  });

  it('carries the vendor scope through to the in-memory grant', () => {
    const vendor = DEMO_USERS.find((u) => u.firebaseUid === demoPersona('vendor').firebaseUid);
    const grant = vendor?.roles.find((role) => role.roleKey === 'VENDOR_OWNER');

    expect(grant?.scopeType).toBe('VENDOR');
    expect(grant?.scopeId).toBeTruthy();
  });

  it('throws for an unknown ref rather than returning undefined', () => {
    expect(() => demoPersona('nobody' as DemoPersonaRef)).toThrow(/Unknown demo persona/);
  });
});

describe('the support persona is genuinely under-privileged', () => {
  /**
   * This persona exists so the permission engine can be observed DENYING. If it ever
   * gained broad permissions, every "support is denied X" test would still pass for the
   * wrong reason — the page would be reachable and the assertion would have quietly
   * stopped testing anything.
   */
  it('reaches the admin surface but holds far fewer permissions than a super admin', () => {
    const support = permissionsForRole('ADMIN_SUPPORT');
    const superAdmin = permissionsForRole('SUPER_ADMIN');

    expect(support.has('dashboard:view')).toBe(true);
    expect(support.size).toBeLessThan(superAdmin.size / 2);
  });

  it.each([
    'refund:manage',
    'setting:manage_sensitive',
    'role:manage',
    'coupon:manage',
    'audit:view',
    'payout:manage',
    'cash:reconcile',
  ] as const)('does not hold %s', (permission) => {
    expect(permissionsForRole('ADMIN_SUPPORT').has(permission)).toBe(false);
  });
});
