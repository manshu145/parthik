import { NextResponse } from 'next/server';
import { toAppError, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { REQUEST_ID_HEADER } from './request-context';

/**
 * API response envelope (docs/API_SPEC.md §1.3).
 *
 * Every route handler returns through these helpers so the shape is identical
 * everywhere and no handler can accidentally leak an internal message.
 *
 *   success: { success: true,  data, meta }
 *   failure: { success: false, error: { code, message, ... }, meta }
 */

export interface ResponseMeta {
  requestId?: string;
  page?: number;
  pageSize?: number;
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export function apiSuccess<T>(
  data: T,
  init: { status?: number; meta?: ResponseMeta; headers?: HeadersInit } = {}
): NextResponse {
  const { status = 200, meta = {}, headers } = init;

  const response = NextResponse.json({ success: true, data, meta }, { status, headers });

  // Authenticated/API responses are never cached by a shared cache.
  response.headers.set('Cache-Control', 'private, no-store');
  if (meta.requestId) response.headers.set(REQUEST_ID_HEADER, meta.requestId);

  return response;
}

/**
 * Converts any thrown value into the documented error envelope.
 *
 * The client receives a stable `code` and safe copy; the internal message and
 * context go to logs only.
 */
export function apiError(error: unknown, meta: ResponseMeta = {}): NextResponse {
  const appError = toAppError(error);

  logger.exception(appError, { requestId: meta.requestId as string | undefined });

  const body: Record<string, unknown> = {
    success: false,
    error: appError.toJSON(),
    meta,
  };

  if (appError instanceof ValidationError) {
    (body.error as Record<string, unknown>).fieldErrors = appError.fieldErrors;
  }

  const response = NextResponse.json(body, { status: appError.status });
  response.headers.set('Cache-Control', 'private, no-store');
  if (meta.requestId) response.headers.set(REQUEST_ID_HEADER, meta.requestId);

  // Rate limiting must tell the caller when to come back.
  if ('retryAfterSeconds' in appError) {
    response.headers.set('Retry-After', String(appError.retryAfterSeconds));
  }

  return response;
}

/** Extracts the request id set by middleware, for log correlation. */
export function requestIdFrom(request: Request): string | undefined {
  return request.headers.get(REQUEST_ID_HEADER) ?? undefined;
}
