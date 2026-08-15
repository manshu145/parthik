import type { LocaleScope } from '@/lib/db/repository';
import type { CmsRepository } from './cms.repository.types';
import type { CmsPage, CmsPageSummary, RedirectRule } from './cms.types';

/**
 * In-memory CMS repository.
 *
 * WHY THIS EXISTS: the application must run with no external dependencies
 * (.kiro/steering/provider-credentials.md), and a managed Postgres provider is still
 * unchosen (D-01a).
 *
 * IT IS EMPTY, AND THAT IS THE POINT. Every other in-memory repository mirrors seed
 * fixtures, but there are no CMS fixtures to mirror: nobody has written Parthik's
 * privacy policy, terms or refund policy, and those are legal documents. Inventing
 * placeholder legal text that read as though it were real would be worse than a page
 * that plainly says the content is being prepared — a visitor might rely on it.
 *
 * So `findPublishedPage` returns null, the marketing routes render their documented
 * "content pending" state with `noindex`, and the moment an admin publishes a page
 * through TASK 016 the same route renders it with no code change.
 *
 * Refused in production by `modules/cms/index.ts`.
 */
export class InMemoryCmsRepository implements CmsRepository {
  findPublishedPage(_slug: string, _locale: LocaleScope): Promise<CmsPage | null> {
    return Promise.resolve(null);
  }

  listPublishedPages(): Promise<CmsPageSummary[]> {
    return Promise.resolve([]);
  }

  findRedirect(_sourcePath: string): Promise<RedirectRule | null> {
    // Redirect rows are written when a slug changes. Nothing has been renamed in a
    // database that does not exist.
    return Promise.resolve(null);
  }
}
