/**
 * Request correlation (docs/ARCHITECTURE.md §11.8).
 *
 * A request id is generated in middleware, propagated to the application via a
 * request header, and returned in the response so a support ticket can be traced
 * end to end.
 */

export const REQUEST_ID_HEADER = 'x-request-id';
export const LOCALE_HEADER = 'x-locale';
export const PATHNAME_HEADER = 'x-pathname';

/**
 * Reuses an inbound request id when present so a trace survives across
 * Cloudflare and any upstream proxy, otherwise mints one.
 */
export function resolveRequestId(headers: Headers): string {
  const inbound = headers.get(REQUEST_ID_HEADER);
  if (inbound && isSafeRequestId(inbound)) return inbound;
  return crypto.randomUUID();
}

/**
 * Inbound ids are attacker-controlled, so they are constrained before being
 * echoed into logs — this prevents log injection via a crafted header.
 */
function isSafeRequestId(value: string): boolean {
  return value.length <= 128 && /^[\w.:-]+$/.test(value);
}
