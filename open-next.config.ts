import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext configuration for Cloudflare Workers (decision D-04).
 *
 * Deliberately minimal for TASK 001. The caching overrides below are the next
 * step and are intentionally NOT enabled yet, because each requires a real
 * Cloudflare resource that does not exist at foundation stage:
 *
 *   incrementalCache: r2IncrementalCache   -> needs the NEXT_INC_CACHE_R2_BUCKET binding
 *   queue:            doQueue              -> needs a Durable Object binding
 *   tagCache:         doShardedTagCache    -> needs a Durable Object binding
 *
 * docs/ARCHITECTURE.md §8 also records the cost caveat: the Durable Object
 * revalidation queue can keep a DO warm, so it must be observed in staging
 * before production.
 */
export default defineCloudflareConfig({});
