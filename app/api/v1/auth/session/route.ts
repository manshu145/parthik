import { cookies } from 'next/headers';
import { clearSessionCookie, setSessionCookie } from '@/lib/auth/session-response';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session-cookie';
import { ConfigurationError, ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { readClientFingerprint } from '@/lib/http/client-fingerprint';
import { logger } from '@/lib/logger';
import { revokeFirebaseRefreshTokens } from '@/lib/firebase/identity-rest';
import { isFirebaseServerConfigured } from '@/lib/firebase/config';
import { describeAuthReadiness, getIdentityService } from '@/modules/identity';
import { createSessionSchema, revokeSessionSchema } from '@/modules/identity/identity.schema';

/**
 * The Firebase token exchange (docs/API_SPEC.md §2, docs/ARCHITECTURE.md §11.1).
 *
 * This is the front door of the application: the single point where an external
 * identity assertion becomes a Parthik session. Everything downstream trusts it, so
 * it is deliberately narrow.
 *
 * A ROUTE HANDLER, NOT A SERVER ACTION. Sign-in is called from a client-side state
 * machine holding Firebase's in-memory `confirmationResult`, and a future mobile app
 * needs the same endpoint (docs/ARCHITECTURE.md §6.2).
 */

export const dynamic = 'force-dynamic';

/**
 * POST — exchange a Firebase ID token for a Parthik session.
 *
 * The response body carries NO token of any kind. The session travels only in an
 * httpOnly cookie, so a successful sign-in leaves nothing for injected script to
 * read.
 */
export async function POST(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const readiness = describeAuthReadiness();
    if (!readiness.ready) {
      // A typed 503 naming the missing variables, rather than a confusing 500 from
      // deep inside the verifier.
      throw new ConfigurationError(
        `Sign-in is not configured in this environment. Missing: ${readiness.missing.join(', ')}.`
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('A JSON body containing an idToken is required.');
    }

    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'A valid Firebase ID token is required.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const service = await getIdentityService();
    const result = await service.exchangeFirebaseToken({
      idToken: parsed.data.idToken,
      locale: parsed.data.locale,
      fingerprint: await readClientFingerprint(request),
    });

    const response = apiSuccess(
      {
        user: {
          id: result.actor.userId,
          phone: result.actor.phone,
          fullName: result.actor.fullName,
          preferredLocale: result.actor.preferredLocale,
          roles: [...new Set(result.actor.roles.map((grant) => grant.roleKey))],
          // Sent so the client can render the correct navigation immediately rather
          // than after a second round trip. Never used FOR authorization — every
          // server call re-derives permissions from the database.
          permissions: [...result.actor.permissions],
        },
        landingPath: result.landingPath,
        isNewUser: result.isNewUser,
      },
      { status: 201, meta: { requestId } }
    );

    setSessionCookie(response, result.token, result.audience);
    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}

/**
 * GET — who am I?
 *
 * Returns 200 with `authenticated: false` for an anonymous caller rather than a 401,
 * because "not signed in" is a normal answer to this question and the client uses it
 * to decide what to render. Reserving 401 for genuine failures keeps error monitoring
 * meaningful.
 */
export async function GET(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!cookieValue) {
      return apiSuccess({ authenticated: false, user: null }, { meta: { requestId } });
    }

    const service = await getIdentityService();

    let context;
    try {
      context = await service.resolveSession(cookieValue);
    } catch {
      // The cookie existed but is no longer usable (revoked, expired, banned). Clear
      // it so the browser stops sending a dead cookie on every request.
      const response = apiSuccess({ authenticated: false, user: null }, { meta: { requestId } });
      clearSessionCookie(response);
      return response;
    }

    if (!context) {
      return apiSuccess({ authenticated: false, user: null }, { meta: { requestId } });
    }

    const response = apiSuccess(
      {
        authenticated: true,
        user: {
          id: context.actor.userId,
          phone: context.actor.phone,
          fullName: context.actor.fullName,
          preferredLocale: context.actor.preferredLocale,
          roles: [...new Set(context.actor.roles.map((grant) => grant.roleKey))],
          permissions: [...context.actor.permissions],
        },
      },
      { meta: { requestId } }
    );

    // Rolling renewal, or a refresh because the user's roles changed since the cookie
    // was signed.
    if (context.renewedCookie) {
      setSessionCookie(response, context.renewedCookie, context.audience);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}

/**
 * DELETE — sign out.
 *
 * Always succeeds and always clears the cookie, even when the session was already
 * invalid. Sign-out that can fail is a genuine hazard: a user on a shared device who
 * sees an error has no way to know whether they are still signed in.
 */
export async function DELETE(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    // A body is optional here; only `allDevices` is read from it.
    let allDevices = false;
    try {
      const parsed = revokeSessionSchema.safeParse(await request.json());
      if (parsed.success) allDevices = parsed.data.allDevices;
    } catch {
      // No body, or unparseable. Default to signing out this device only.
    }

    let revoked = 0;

    if (cookieValue) {
      const service = await getIdentityService();

      /**
       * Identify the caller BEFORE revoking.
       *
       * Ordering is load-bearing: revoking first makes the session unresolvable, so a
       * subsequent lookup returns nothing and the Firebase refresh tokens would
       * silently never be revoked — leaving "sign out everywhere" only half done,
       * which is precisely the case where it matters.
       */
      const firebaseUid = allDevices ? await resolveFirebaseUidQuietly(service, cookieValue) : null;

      const result = await service.revokeSession({ cookieValue, allDevices });
      revoked = result.revoked;

      // Firebase refresh tokens are revoked only for "everywhere", because that is
      // the request that means "I may be compromised". Doing it on an ordinary
      // sign-out would also end the user's other sessions, which they did not ask for.
      if (allDevices && firebaseUid && isFirebaseServerConfigured()) {
        try {
          await revokeFirebaseRefreshTokens(firebaseUid);
        } catch (error) {
          // Our own sessions are already revoked, which is the part that protects the
          // account. A Firebase failure is logged, never surfaced as a failed
          // sign-out.
          logger.warn('Could not revoke Firebase refresh tokens', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const response = apiSuccess({ signedOut: true, revoked }, { meta: { requestId } });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}

/**
 * Reads the Firebase uid behind a cookie without throwing.
 *
 * Used only on the sign-out path, where failing to identify the user must not prevent
 * the cookie being cleared.
 */
async function resolveFirebaseUidQuietly(
  service: Awaited<ReturnType<typeof getIdentityService>>,
  cookieValue: string
): Promise<string | null> {
  try {
    const context = await service.resolveSession(cookieValue);
    return context?.actor.firebaseUid ?? null;
  } catch {
    return null;
  }
}
