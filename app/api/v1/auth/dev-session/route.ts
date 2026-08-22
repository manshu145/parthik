import { z } from 'zod';
import { setSessionCookie } from '@/lib/auth/session-response';
import { getServerEnv } from '@/lib/config/env';
import { ConfigurationError, NotFoundError, ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { readClientFingerprint } from '@/lib/http/client-fingerprint';
import { logger } from '@/lib/logger';
import { canIssueSessions } from '@/lib/auth/session-token';
import { DEMO_USERS, getIdentityService } from '@/modules/identity';

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

const bodySchema = z.object({
  role: z.enum(['customer', 'vendor', 'driver', 'admin', 'support']),
});

/** Maps a requested persona to its seeded Firebase uid. */
const DEMO_UID_BY_ROLE: Record<z.infer<typeof bodySchema>['role'], string> = {
  customer: 'demo-customer-uid',
  vendor: 'demo-vendor-uid',
  driver: 'demo-driver-uid',
  admin: 'demo-admin-uid',
  /** ADMIN_SUPPORT — reaches /admin but is denied most pages. */
  support: 'demo-support-uid',
};

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const env = getServerEnv();

  // Both gates, in order of severity. A plain 404 so the endpoint's existence is not
  // confirmed in an environment where it is unavailable.
  if (env.APP_ENV === 'production' || !env.DEV_AUTH_ENABLED) {
    return new Response(null, { status: 404 });
  }

  try {
    if (!canIssueSessions()) {
      throw new ConfigurationError('AUTH_SECRET must be set to issue a development session.');
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('A role of customer, vendor, driver or admin is required.');
    }

    const firebaseUid = DEMO_UID_BY_ROLE[parsed.data.role];
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
      role: parsed.data.role,
      userId: result.actor.userId,
      appEnv: env.APP_ENV,
    });

    const response = apiSuccess(
      {
        role: parsed.data.role,
        user: {
          id: result.actor.userId,
          phone: result.actor.phone,
          roles: [...new Set(result.actor.roles.map((grant) => grant.roleKey))],
        },
        landingPath: result.landingPath,
        notice: 'Development session. This endpoint is 404 in production.',
      },
      { status: 201, meta: { requestId } }
    );

    setSessionCookie(response, result.token, result.audience);
    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}

/** GET lists the available personas, so a developer need not read this file. */
export function GET() {
  const env = getServerEnv();

  if (env.APP_ENV === 'production' || !env.DEV_AUTH_ENABLED) {
    return new Response(null, { status: 404 });
  }

  return apiSuccess({
    roles: Object.keys(DEMO_UID_BY_ROLE),
    demoUsers: DEMO_USERS.map((user) => ({
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      roles: user.roles.map((role) => role.roleKey),
    })),
    notice: 'Development only. POST { "role": "admin" } to sign in as that persona.',
  });
}
