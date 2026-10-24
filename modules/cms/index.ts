import { getServerEnv } from '@/lib/config/env';
import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { InMemoryCmsRepository } from './cms-memory.repository';
import { createCmsRepository } from './cms.repository';
import type { CmsRepository } from './cms.repository.types';
import { CmsService } from './cms.service';

/**
 * CMS module composition root.
 *
 * Pages and route handlers call `getCmsService()` and never construct a repository,
 * so the credential-free fallback rule lives in exactly one place.
 */

export type CmsBackend = 'postgres' | 'memory';

let warnedAboutMemory = false;

/**
 * Chooses the repository.
 *
 * PostgreSQL when configured; the empty in-memory repository otherwise, so the
 * marketing routes render their "content pending" state instead of failing.
 *
 * In PRODUCTION the in-memory repository is never used. It reports every page as
 * missing, which would take the live privacy policy and terms offline — a legal
 * problem, not just a broken page.
 */
export function resolveCmsBackend(): CmsBackend {
  const env = getServerEnv();

  if (isDatabaseConfigured()) return 'postgres';
  if (env.APP_ENV === 'production') return 'postgres';

  if (!warnedAboutMemory) {
    warnedAboutMemory = true;
    logger.info('CMS pages unavailable — no database configured', { appEnv: env.APP_ENV });
  }

  return 'memory';
}

async function createRepository(): Promise<CmsRepository> {
  if (resolveCmsBackend() === 'memory') {
    return new InMemoryCmsRepository();
  }

  const db = await getDb();
  return createCmsRepository({ db });
}

export async function getCmsService(): Promise<CmsService> {
  return new CmsService({ repository: await createRepository() });
}

/** Test-only: clears the one-time log guard. */
export function resetCmsBackendWarningForTests(): void {
  warnedAboutMemory = false;
}

export { InMemoryCmsRepository } from './cms-memory.repository';
export { DrizzleCmsRepository, createCmsRepository } from './cms.repository';
export {
  CmsService,
  createCmsService,
  isMarketingSlug,
  isSafeRedirectPath,
  MARKETING_SLUGS,
} from './cms.service';
export type { CmsServiceDeps, MarketingSlug } from './cms.service';
export type { CmsRepository } from './cms.repository.types';
export type { CmsPage, CmsPageSummary, CmsPageType, RedirectRule } from './cms.types';
