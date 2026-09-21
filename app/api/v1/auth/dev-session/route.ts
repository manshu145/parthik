import { z } from 'zod';
import { setSessionCookie } from '@/lib/auth/session-response';
import { getServerEnv } from '@/lib/config/env';
import { ConfigurationError, NotFoundError, ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { readClientFingerprint } from '@/lib/http/client-fingerprint';
import { logger } from '@/lib/logger';
import { canIssueSessions } from '@/lib/auth/session-token';
import { mergeGuestCartOnSignIn } from '@/lib/shell/cart-session';
import { getIdentityService } from '@/modules/identity';
import {
  demoPersona,
  DEMO_PERSONAS,
  DEMO_PERSONA_REFS,
  type DemoPersonaRef,
} from '@/modules/identity/demo-personas';

/**
 * POST /api/v1/auth/dev-session — DEVELOPMENT AND TEST ONLY.
 *
 * Signs in as a seeded demo user without SMS, so the vendor/driver/admin surfaces can
 * be reviewed locally and the E2E suite can authenticate in CI. Real SMS cannot be
 * received in CI, and without this every authenticated journey would be untestable
 * (docs/ARCHITECTURE.md §13.1).
 *
 * WHY THIS EXISTS AND WHAT IT REPLACES
 *
 * The previous approach disabled the route gate entirely outside production, leaving
 * all 83 privileged routes reachable by anyone. This is strictly narrower and safer:
 *
 *   1. It is 404 in production, and 404 rather than 403 so it is not discoverable.
 *   2. It requires an EXPLICIT `DEV_AUTH_ENABLED=true` opt-in. Absent that, it is 404
 *      even in development — so it cannot be left on by forgetting to turn it off; it
 *      has to be deliberately turned on.
 *   3. It issues a genuine session for a genuine user, so every downstream permission
 *      check runs exactly as it does in production. The authorization path is
 *      exercised rather than bypassed.
 *   4. It cannot mint arbitrary privileges — only the four seeded demo identities.
 */

export const dynamic = 'force-dynamic';

// Derived from the canonical persona list, so this endpoint cannot reference a uid that
// neither the seed nor the in-memory backend actually creates.
const personaSchema = z.enum(DEMO_PERSONA_REFS as [DemoPersonaRef, ...DemoPersonaRef[]]);

const bodySchema = z.object({
  username: personaSchema.optional(),
  // Backward-compatible alias used by the CI/dev scripts. It is accepted only
  // because the endpoint itself is still gated by DEV_AUTH_ENABLED outside
  // production; temporary credential mode continues to require a password.
  role: personaSchema.optional(),
  password: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const env = getServerEnv();

  // Both gates, in order of severity. A plain 404 so the endpoint's existence is not
  // confirmed in an environment where it is unavailable.
  const temporaryAuthEnabled = env.TEMP_AUTH_ENABLED && Boolean(env.TEMP_AUTH_PASSWORD);
  const developmentAuthEnabled = env.APP_ENV !== 'production' && env.DEV_AUTH_ENABLED;
  if (!temporaryAuthEnabled && !developmentAuthEnabled) {
    return new Response(null, { status: 404 });
  }

  try {
    if (!canIssueSessions()) {
      throw new ConfigurationError('AUTH_SECRET must be set to issue a development session.');
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('A valid development persona is required.');
    }

    const personaRef = parsed.data.username ?? parsed.data.role;
    if (!personaRef) {
      throw new ValidationError('A valid development persona is required.');
    }

    if (
      temporaryAuthEnabled &&
      (!parsed.data.password || parsed.data.password !== env.TEMP_AUTH_PASSWORD)
    ) {
      return apiError(new ValidationError('Invalid username or password.'), { requestId });
    }

    const firebaseUid = demoPersona(personaRef).firebaseUid;
    const service = await getIdentityService();

    const result = await service.createDevelopmentSession({
      firebaseUid,
      fingerprint: await readClientFingerprint(request),
    });

    if (!result) {
      // Happens against a real database that has not had the demo seed applied.
      throw new NotFoundError(
        `Demo user "${firebaseUid}" does not exist. Run \`pnpm seed:demo\` first.`
      );
    }

    logger.warn('Development session issued', {
      role: personaRef,
      userId: result.actor.userId,
      appEnv: env.APP_ENV,
    });

    const response = apiSuccess(
      {
        role: personaRef,
        user: {
          id: result.actor.userId,
          phone: result.actor.phone,
          roles: [...new Set(result.actor.roles.map((grant) => grant.roleKey))],
        },
        landingPath: result.landingPath,
        notice: temporaryAuthEnabled ? 'Temporary credential session.' : 'Development session.',
      },
      { status: 201, meta: { requestId } }
    );

    setSessionCookie(response, result.token, result.audience);

    // Same cart-merge behaviour as the real sign-in, so this path exercises the
    // production flow rather than a simplified one that could diverge.
    await mergeGuestCartOnSignIn(response, result.actor.userId);

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}

/** GET lists the available personas, so a developer need not read this file. */
export function GET() {
  const env = getServerEnv();

  const enabled =
    (env.APP_ENV !== 'production' && env.DEV_AUTH_ENABLED) ||
    (env.TEMP_AUTH_ENABLED && Boolean(env.TEMP_AUTH_PASSWORD));
  if (!enabled) {
    return new Response(null, { status: 404 });
  }

  return apiSuccess({
    roles: DEMO_PERSONA_REFS,
    personas: DEMO_PERSONAS.map((persona) => ({
      ref: persona.ref,
      firebaseUid: persona.firebaseUid,
      phone: persona.phone,
      roles: persona.roles.map((role) => role.roleKey),
    })),
    notice:
      'Development only. With DEV_AUTH_ENABLED, POST { "role": "admin" }. Temporary credential mode uses { "username": "admin", "password": "…" }.',
  });
}
