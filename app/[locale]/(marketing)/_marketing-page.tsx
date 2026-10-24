import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { defaultLocale, isLocale, type Locale } from '@/i18n/routing';
import { PageShell } from '@/components/layout/page-shell';
import { JsonLd } from '@/components/seo/json-ld';
import { CmsContent } from '@/components/cms/cms-content';
import { DefaultMarketingContent } from '@/components/marketing/default-marketing-content';
import { breadcrumbJsonLd } from '@/lib/seo/json-ld';
import { canonicalUrl, privatePageMetadata, publicPageMetadata } from '@/lib/seo/metadata';
import { logger } from '@/lib/logger';
import { getCmsService, isMarketingSlug, type CmsPage, type MarketingSlug } from '@/modules/cms';

/**
 * Shared implementation for every marketing and legal page (docs/ROUTES.md §3,
 * master spec §19, D-30).
 *
 * WHY A SHARED FUNCTION AND TWELVE THIN ROUTE FILES, rather than one `[slug]` route:
 *
 * A dynamic `[slug]` at this level matches EVERY unmatched single-segment path, and
 * `notFound()` inside a dynamic route cannot set a 404 status here — Next applies
 * automatic Suspense boundaries and the response shell is already committed (see
 * app/[locale]/not-found.tsx). `/fr` and `/this-does-not-exist` would then answer
 * 200. `dynamicParams = false` does not help either, because this group's layout
 * reads cookies for the header location and cart badge, which makes the route
 * dynamic regardless.
 *
 * Static route folders make routing STRUCTURAL: an unknown path matches nothing and
 * Next returns its own real 404. The cost is twelve three-line files; the benefit is
 * that the site keeps telling the truth about what exists.
 *
 * The content itself is CMS-managed, so all twelve share one implementation and one
 * markup path.
 *
 * BEFORE THESE EXISTED every footer link was a 404. That is the bug this closes: the
 * links were real, the pages were not.
 *
 * WHEN THERE IS NO CONTENT YET the page renders, states plainly that the content is
 * being prepared, and is `noindex`. It does NOT render invented legal text — a
 * visitor could rely on a plausible-looking privacy policy, and a placeholder one is
 * worse than an honest blank.
 */

async function loadPage(slug: string, locale: Locale): Promise<CmsPage | null> {
  try {
    const cms = await getCmsService();
    return await cms.getPage(slug, locale);
  } catch (error) {
    // A CMS outage must not take the page down with a 500. It renders the pending
    // state instead, which is the same honest outcome as no content.
    logger.exception(error, { slug });
    return null;
  }
}

/** Builds the metadata for one marketing page. Called by each route's `generateMetadata`. */
export async function marketingMetadata(
  slug: MarketingSlug,
  localeParam: string
): Promise<Metadata> {
  const locale: Locale = isLocale(localeParam) ? localeParam : defaultLocale;
  const t = await getTranslations({ locale, namespace: 'marketing' });
  const page = await loadPage(slug, locale);
  const fallbackTitle = t(`titles.${slug}` as 'titles.about');

  // Built-in production copy keeps public/legal routes useful before an operator
  // publishes a CMS override. CMS content still wins as soon as it exists.
  if (!page) {
    return publicPageMetadata({
      title: fallbackTitle,
      description: t('defaultDescription'),
      path: `/${slug}`,
      locale,
      siteName: t('siteName'),
    });
  }

  if (!page.isIndexable) return privatePageMetadata(page.metaTitle ?? page.title);

  return publicPageMetadata({
    title: page.metaTitle ?? page.title,
    description: page.metaDescription ?? t('defaultDescription'),
    path: `/${slug}`,
    locale,
    siteName: t('siteName'),
  });
}

/** Renders one marketing page. Called by each route's default export. */
export async function MarketingPage({
  slug,
  localeParam,
}: {
  slug: MarketingSlug;
  localeParam: string;
}) {
  if (!isLocale(localeParam)) notFound();
  setRequestLocale(localeParam);

  // Defensive: the route files pass literals, so this cannot fail in practice.
  if (!isMarketingSlug(slug)) notFound();

  const t = await getTranslations('marketing');
  const tCatalog = await getTranslations('catalog');
  const page = await loadPage(slug, localeParam);
  const title = page?.title ?? t(`titles.${slug}` as 'titles.about');

  return (
    <PageShell title={title}>
      {page ? (
        <>
          <JsonLd
            data={breadcrumbJsonLd([
              { name: tCatalog('breadcrumbHome'), url: canonicalUrl('/', localeParam) },
              { name: title },
            ])}
          />

          {/* Says so rather than silently serving English under a Hindi URL (D-33). */}
          {page.usedFallbackLocale && (
            <p
              role="status"
              className="border-border bg-muted mb-4 rounded-[var(--radius-control)] border p-3 text-xs"
              data-testid="cms-fallback-notice"
            >
              {t('englishOnlyNotice')}
            </p>
          )}

          <CmsContent content={page.content} />
        </>
      ) : (
        <DefaultMarketingContent slug={slug} locale={localeParam} />
      )}
    </PageShell>
  );
}
