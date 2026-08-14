import { z } from 'zod';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { logger } from '@/lib/logger';
import { ValidationError } from '@/lib/errors';

/**
 * Browser error intake — interim mitigation for open item D-27a.
 *
 * Google Cloud Monitoring covers the server well but provides no source-mapped
 * JavaScript stack traces, and Crashlytics does not cover web. Until that
 * decision is resolved, client errors are forwarded to Cloud Logging WITHOUT
 * symbolication, which is better than having no client-side visibility at all.
 *
 * This endpoint is public, so it is strictly bounded: fields are capped, the
 * payload is size-limited, and it must be rate-limited at 20/min per IP once the
 * limiter exists in TASK 003 (docs/SECURITY.md §6).
 */

const MAX_BODY_BYTES = 8_192;

const schema = z.object({
  message: z.string().min(1).max(500),
  digest: z.string().max(100).optional(),
  stack: z.string().max(4_000).optional(),
  url: z.string().max(2_000).optional(),
});

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) {
      throw new ValidationError('Report too large.');
    }

    const raw: unknown = await request.json();
    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
      throw new ValidationError('Invalid error report.');
    }

    // Logged at warn, not error: a client-side exception is not a server fault
    // and must not pollute server error alerting.
    logger.warn('Client-side error reported', {
      requestId,
      clientMessage: parsed.data.message,
      clientDigest: parsed.data.digest,
      clientUrl: parsed.data.url,
      stack_trace: parsed.data.stack,
      userAgent: request.headers.get('user-agent') ?? undefined,
      source: 'browser',
    });

    // 204-style acknowledgement; the client never needs a body back.
    return apiSuccess({ received: true }, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
