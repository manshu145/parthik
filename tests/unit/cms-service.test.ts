import { describe, expect, it } from 'vitest';
import {
  CmsService,
  isMarketingSlug,
  isSafeRedirectPath,
  MARKETING_SLUGS,
} from '@/modules/cms/cms.service';
import { InMemoryCmsRepository } from '@/modules/cms/cms-memory.repository';
import type { CmsRepository } from '@/modules/cms/cms.repository.types';
import type { CmsPage, CmsPageSummary, RedirectRule } from '@/modules/cms/cms.types';
import { FOOTER_SECTIONS } from '@/lib/navigation/nav-config';

/**
 * CMS pages and managed redirects (master spec §19–§20, D-30).
 *
 * Two things are load-bearing here and both are security- or SEO-critical:
 *
 *   - the marketing slug ALLOW-LIST, because `/[slug]` would otherwise render a page
 *     for every unmatched path, including probes
 *   - redirect target validation, because a redirects table that accepts absolute
 *     URLs is an open redirect with an admin UI on top
 */

function repositoryWith(overrides: Partial<CmsRepository> = {}): CmsRepository {
  return {
    findPublishedPage: () => Promise.resolve(null),
    listPublishedPages: () => Promise.resolve([]),
    findRedirect: () => Promise.resolve(null),
    ...overrides,
  };
}

function service(overrides: Partial<CmsRepository> = {}): CmsService {
  return new CmsService({ repository: repositoryWith(overrides) });
}

function page(overrides: Partial<CmsPage> = {}): CmsPage {
  return {
    id: 'page-1',
    slug: 'privacy',
    pageType: 'LEGAL',
    title: 'Privacy policy',
    content: null,
    usedFallbackLocale: false,
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    metaTitle: null,
    metaDescription: null,
    isIndexable: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Slug allow-list
// ---------------------------------------------------------------------------

describe('marketing slugs', () => {
  it.each([...MARKETING_SLUGS])('accepts %s', (slug) => {
    expect(isMarketingSlug(slug)).toBe(true);
  });

  it.each(['wp-admin', 'admin', '.env', 'foo', '', 'PRIVACY', 'privacy/'])('rejects %s', (slug) => {
    // An allow-list, not a pattern: an unmatched path must 404, not render a page
    // that a crawler could then index.
    expect(isMarketingSlug(slug)).toBe(false);
  });

  it('covers every single-segment footer link', () => {
    // The bug this route closed: the footer linked to twelve pages that did not
    // exist. If a footer link is added without a slug here, it 404s again.
    const footerPaths = FOOTER_SECTIONS.flatMap((section) =>
      section.items.map((item) => item.href)
    );
    const singleSegment = footerPaths.filter(
      (href) => href.startsWith('/') && href.slice(1).split('/').length === 1 && href !== '/'
    );

    for (const href of singleSegment) {
      expect(isMarketingSlug(href.slice(1)), `${href} has no CMS page route`).toBe(true);
    }
  });

  it('does not claim a slug that a real route already owns', () => {
    // `/[slug]` must never shadow `/cart`, `/offers`, `/search` and friends.
    for (const reserved of [
      'cart',
      'offers',
      'search',
      'categories',
      'login',
      'account',
      'checkout',
      'favorites',
      'orders',
      'vendor',
      'driver',
      'admin',
      'api',
      'products',
      'category',
    ]) {
      expect(isMarketingSlug(reserved), `${reserved} is a real route`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

describe('pages', () => {
  it('returns a published page', async () => {
    const result = await service({ findPublishedPage: () => Promise.resolve(page()) }).getPage(
      'privacy',
      'en'
    );

    expect(result?.title).toBe('Privacy policy');
  });

  it('returns null when nothing is published', async () => {
    expect(await service().getPage('privacy', 'en')).toBeNull();
  });

  it('excludes non-indexable pages from the sitemap', async () => {
    const pages: CmsPageSummary[] = [
      { slug: 'about', updatedAt: new Date(), isIndexable: true },
      { slug: 'careers', updatedAt: new Date(), isIndexable: false },
    ];

    const result = await service({
      listPublishedPages: () => Promise.resolve(pages),
    }).getSitemapPages();

    expect(result.map((entry) => entry.slug)).toEqual(['about']);
  });
});

// ---------------------------------------------------------------------------
// Redirect safety
// ---------------------------------------------------------------------------

describe('redirect target safety', () => {
  it.each(['/about', '/products/atta', '/hi/offers'])('accepts the site-relative %s', (target) => {
    expect(isSafeRedirectPath(target)).toBe(true);
  });

  it.each([
    'https://evil.example',
    'http://evil.example',
    '//evil.example',
    '/\\evil.example',
    'about',
    '',
    'javascript:alert(1)',
  ])('rejects %s', (target) => {
    // `//evil.example` is protocol-relative and browsers treat it as absolute — the
    // classic open-redirect bypass that a leading-slash check alone lets through.
    expect(isSafeRedirectPath(target)).toBe(false);
  });
});

describe('resolving a redirect', () => {
  function withRule(rule: RedirectRule) {
    return service({ findRedirect: () => Promise.resolve(rule) });
  }

  it('returns null when no rule exists', async () => {
    expect(await service().resolveRedirect('/old')).toBeNull();
  });

  it('normalises a 301 to a 308 permanent redirect', async () => {
    // 308 preserves the request method as well as the ranking signal.
    const rule = await withRule({
      sourcePath: '/old',
      targetPath: '/new',
      statusCode: 301,
    }).resolveRedirect('/old');

    expect(rule).toMatchObject({ targetPath: '/new', statusCode: 308 });
  });

  it('keeps a temporary redirect temporary', async () => {
    const rule = await withRule({
      sourcePath: '/old',
      targetPath: '/new',
      statusCode: 302,
    }).resolveRedirect('/old');

    expect(rule?.statusCode).toBe(307);
  });

  it('treats an unexpected status as permanent', async () => {
    const rule = await withRule({
      sourcePath: '/old',
      targetPath: '/new',
      statusCode: 200,
    }).resolveRedirect('/old');

    expect(rule?.statusCode).toBe(308);
  });

  it('refuses an off-site target', async () => {
    // The admin who typed this may not have realised what they were creating.
    const rule = await withRule({
      sourcePath: '/old',
      targetPath: 'https://evil.example/phish',
      statusCode: 301,
    }).resolveRedirect('/old');

    expect(rule).toBeNull();
  });

  it('refuses a rule that points at itself', async () => {
    const rule = await withRule({
      sourcePath: '/loop',
      targetPath: '/loop',
      statusCode: 301,
    }).resolveRedirect('/loop');

    expect(rule).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// In-memory repository
// ---------------------------------------------------------------------------

describe('in-memory repository', () => {
  const repository = new InMemoryCmsRepository();

  it('reports every page as unpublished', async () => {
    // Deliberately empty: nobody has written Parthik's privacy policy, and inventing
    // legal text a visitor might rely on would be worse than an honest blank.
    expect(await repository.findPublishedPage('privacy', { locale: 'en' })).toBeNull();
    expect(await repository.listPublishedPages()).toEqual([]);
  });

  it('reports no redirects', async () => {
    expect(await repository.findRedirect('/old')).toBeNull();
  });
});
