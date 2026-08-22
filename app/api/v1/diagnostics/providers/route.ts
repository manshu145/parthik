import { getServerEnv } from '@/lib/config/env';
import { apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { resolveMapsProvider } from '@/lib/maps/provider-factory';
import { describeMockFixtures } from '@/lib/maps/mock-provider';
import { describeLocationBackend } from '@/modules/location';
import { describeCatalogBackend } from '@/modules/catalog';
import { describeSearchBackend } from '@/modules/search';
import { describePaymentBackend } from '@/modules/payment';
import { describeMockGateway } from '@/lib/payments/mock-provider';

/**
 * GET /api/v1/diagnostics/providers — DEVELOPMENT ONLY.
 *
 * Answers "why am I seeing mock data?" without anyone having to read the factory
 * code, which is the single most common source of confusion when real and mock
 * providers coexist.
 *
 * TWO SECURITY RULES, both non-negotiable
 * (.kiro/steering/provider-credentials.md):
 *
 *   1. It returns 404 — not 403 — in production. A 403 would confirm the endpoint
 *      exists; a 404 reveals nothing about the deployment's shape.
 *   2. It reports only BOOLEANS and provider NAMES. No key, no key prefix, no key
 *      length, no connection string. Knowing that a key is configured is useful;
 *      knowing anything about its value never is.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const env = getServerEnv();

  // Not registered in production. `notFound()` is avoided here so the response
  // stays a plain 404 rather than rendering an error page for an API path.
  if (env.APP_ENV === 'production') {
    return new Response(null, { status: 404 });
  }

  const maps = resolveMapsProvider();
  const location = describeLocationBackend();
  const catalog = describeCatalogBackend();
  const search = describeSearchBackend();
  const paymentsBackend = describePaymentBackend();

  return apiSuccess(
    {
      appEnv: env.APP_ENV,
      maps: {
        configured: env.MAPS_PROVIDER,
        active: maps.name,
        // True when the mock is standing in because no key is present.
        usingMockFallback: maps.isFallback,
        serverKeyPresent: Boolean(env.GOOGLE_MAPS_SERVER_KEY),
        ...(maps.name === 'mock' ? { fixtures: describeMockFixtures() } : {}),
      },
      location: {
        backend: location.backend,
        databaseConfigured: location.databaseConfigured,
        ...(location.serviceablePincodes
          ? { serviceablePincodes: location.serviceablePincodes }
          : {}),
      },
      catalog: {
        backend: catalog.backend,
        databaseConfigured: catalog.databaseConfigured,
        ...(catalog.categorySlugs ? { categorySlugs: catalog.categorySlugs } : {}),
        ...(catalog.productSlugs ? { productSlugs: catalog.productSlugs } : {}),
      },
      search: {
        backend: search.backend,
        databaseConfigured: search.databaseConfigured,
      },
      payments: {
        configured: env.PAYMENTS_PROVIDER,
        active: paymentsBackend.provider,
        usingMockFallback: paymentsBackend.isFallback,
        // Reported separately because a deployment can have one and not the other, and a key
        // pair without a webhook secret can take money it will never be able to confirm.
        keyPairPresent: paymentsBackend.canCreateIntents,
        webhookSecretPresent: paymentsBackend.canVerifyWebhooks,
        databaseConfigured: paymentsBackend.databaseConfigured,
        ...(paymentsBackend.usingMockGateway ? { gateway: describeMockGateway() } : {}),
      },
      notes: [
        'Development diagnostics. This endpoint returns 404 in production.',
        'Mock providers are never used in production; a missing credential fails with a 503 instead.',
      ],
    },
    { meta: { requestId: requestIdFrom(request) } }
  );
}
