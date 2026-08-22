/**
 * Manual verification of the authentication flow against the in-memory backend.
 *
 * Uses emulator-shaped (unsigned) Firebase tokens, which the verifier accepts only
 * when FIREBASE_AUTH_EMULATOR_HOST is set outside production — so this exercises the
 * real code path without a Firebase project or any billable call.
 *
 * Run with: npx tsx scripts/check-auth-flow.mts
 */
process.env.APP_ENV = 'development';
process.env.AUTH_SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
process.env.FIREBASE_PROJECT_ID = 'parthik-test';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const { IdentityService } = await import('../modules/identity/identity.service');
const { InMemoryIdentityRepository } =
  await import('../modules/identity/identity-memory.repository');
const { can } = await import('../modules/identity/identity.policy');

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function emulatorToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64url({ alg: 'none', typ: 'JWT' }),
    b64url({
      iss: 'https://securetoken.google.com/parthik-test',
      aud: 'parthik-test',
      sub: 'demo-admin-uid',
      iat: now,
      exp: now + 3600,
      auth_time: now,
      phone_number: '+919000000004',
      firebase: { sign_in_provider: 'phone' },
      ...claims,
    }),
    '',
  ].join('.');
}

const repository = new InMemoryIdentityRepository();
const service = new IdentityService({ repository });
const roleKeysOf = (actor: { roles: Array<{ roleKey: string }> }) =>
  actor.roles.map((grant) => grant.roleKey);

// 1. Happy path: the seeded admin signs in.
const result = await service.exchangeFirebaseToken({
  idToken: emulatorToken({}),
  fingerprint: { ipHash: 'iphash-a', userAgent: 'test' },
});
console.log('1. exchange          ->', {
  roles: roleKeysOf(result.actor),
  audience: result.audience,
  landingPath: result.landingPath,
  isNewUser: result.isNewUser,
  permissions: result.actor.permissions.size,
});

// 2. The cookie resolves back to the same actor, with real permissions.
const context = await service.resolveSession(result.token.cookieValue);
console.log('2. resolveSession    ->', {
  sameUser: context?.actor.userId === result.actor.userId,
  audience: context?.audience,
  canRefund: context ? can(context.actor, 'refund:manage') : null,
  canSensitiveSetting: context ? can(context.actor, 'setting:manage_sensitive') : null,
});

// 3. A tampered signature must be refused.
try {
  await service.resolveSession(`${result.token.cookieValue.slice(0, -3)}AAA`);
  console.log('3. tampered cookie   -> ACCEPTED  <-- SECURITY BUG');
} catch (error) {
  console.log('3. tampered cookie   -> rejected:', (error as Error).constructor.name);
}

// 4. Revocation must take effect immediately (D-10).
await service.revokeSession({ cookieValue: result.token.cookieValue, allDevices: false });
try {
  await service.resolveSession(result.token.cookieValue);
  console.log('4. revoked session   -> STILL VALID  <-- SECURITY BUG');
} catch (error) {
  console.log('4. revoked session   -> rejected:', (error as Error).message);
}

// 5. A first-time user gets CUSTOMER only and lands on the shop.
const fresh = await service.exchangeFirebaseToken({
  idToken: emulatorToken({ sub: 'brand-new-uid', phone_number: '+919111111111' }),
  fingerprint: { ipHash: 'iphash-b', userAgent: 'test' },
});
console.log('5. new user          ->', {
  isNewUser: fresh.isNewUser,
  roles: roleKeysOf(fresh.actor),
  audience: fresh.audience,
  landingPath: fresh.landingPath,
  canViewDashboard: can(fresh.actor, 'dashboard:view'),
});

// 6. A token minted for another Firebase project must be refused.
try {
  await service.exchangeFirebaseToken({
    idToken: emulatorToken({ aud: 'someone-elses-project' }),
    fingerprint: { ipHash: 'iphash-c', userAgent: 'test' },
  });
  console.log('6. wrong audience    -> ACCEPTED  <-- SECURITY BUG');
} catch (error) {
  console.log('6. wrong audience    -> rejected:', (error as Error).constructor.name);
}

// 7. Only phone sign-in is permitted in V1 (D-09).
try {
  await service.exchangeFirebaseToken({
    idToken: emulatorToken({ firebase: { sign_in_provider: 'google.com' } }),
    fingerprint: { ipHash: 'iphash-d', userAgent: 'test' },
  });
  console.log('7. google provider   -> ACCEPTED  <-- SECURITY BUG');
} catch (error) {
  console.log('7. google provider   -> rejected:', (error as Error).constructor.name);
}

// 8. Repeated failures from one IP must throttle.
repository.seedFailedAttemptsForTests('iphash-throttled', 10);
try {
  await service.exchangeFirebaseToken({
    idToken: emulatorToken({}),
    fingerprint: { ipHash: 'iphash-throttled', userAgent: 'test' },
  });
  console.log('8. throttle          -> NOT ENFORCED  <-- BUG');
} catch (error) {
  console.log('8. throttle          -> rejected:', (error as Error).constructor.name);
}

// 9. A suspended account must not receive a session.
repository.setStatusForTests(result.actor.userId, 'SUSPENDED');
try {
  await service.exchangeFirebaseToken({
    idToken: emulatorToken({}),
    fingerprint: { ipHash: 'iphash-e', userAgent: 'test' },
  });
  console.log('9. suspended account -> ACCEPTED  <-- SECURITY BUG');
} catch (error) {
  console.log('9. suspended account -> rejected:', (error as Error).constructor.name);
}
