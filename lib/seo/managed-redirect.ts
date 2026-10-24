import { permanentRedirect, redirect, unstable_rethrow } from 'next/navigation';
import { logger } from '@/lib/logger';
import { getCmsService } from '@/modules/cms';

/**
 * Honours the managed `redirects` table before giving up on a path.
 *
 * WHY IT LIVES HERE AND NOT IN MIDDLEWARE: middleware runs in the constrained edge
 * environment with no database access at all (docs/ARCHITECTURE.md §4.2). This runs
 * inside the page's own server render, where a query is available.
 *
 * WHY IT RUNS ON THE MISS PATH ONLY: a product or category that resolved normally
 * never touches the redirects table, so the cost is paid exactly once per broken
 * link rather than on every request.
 *
 * WHAT IT IS FOR: docs/ROUTES.md §11 — "slug changes always write a `redirects` row
 * so links and rankings survive". A renamed product would otherwise 404 for every
 * inbound link and every indexed result.
 *
 * Either redirects (by throwing, which is how Next signals one) or returns, leaving
 * the caller to raise the 404. It deliberately does NOT call `notFound()` itself:
 * TypeScript cannot narrow a union across an awaited `never`, so the caller's own
 * `notFound()` is what keeps the code after the guard properly typed.
 */
export async function redirectIfRenamed(path: string): Promise<void> {
  try {
    const cms = await getCmsService();
    const rule = await cms.resolveRedirect(path);

    if (rule) {
      // 308 preserves the request method as well as the ranking signal; 307 is the
      // temporary equivalent. The service has already rejected off-site targets.
      if (rule.statusCode === 308) permanentRedirect(rule.targetPath);
      redirect(rule.targetPath);
    }
  } catch (error) {
    // `redirect()` and `permanentRedirect()` signal by THROWING, so they must be
    // allowed to propagate. Swallowing them here would turn a working redirect into
    // a 404 — the exact bug `unstable_rethrow` exists to prevent.
    unstable_rethrow(error);

    // A genuine failure (no database, query error) falls through to the 404, which is
    // the correct answer for an unresolvable path anyway.
    logger.exception(error, { path });
  }
}
