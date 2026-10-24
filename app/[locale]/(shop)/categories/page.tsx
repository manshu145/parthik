import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { defaultLocale, isLocale } from '@/i18n/routing';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { CategoryGrid } from '@/components/catalog/category-card';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbJsonLd } from '@/lib/seo/json-ld';
import { canonicalUrl, publicPageMetadata, siteName } from '@/lib/seo/metadata';
import { getCatalogService } from '@/modules/catalog';
import { logger } from '@/lib/logger';

/**
 * Category tree (docs/ROUTES.md §4).
 *
 * Renders every active category with its children, so the whole catalogue is
 * reachable in one hop and crawlable without JavaScript.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.categories' });

  const resolved = isLocale(locale) ? locale : defaultLocale;

  return publicPageMetadata({
    title: t('title'),
    description: t('heading'),
    path: '/categories',
    locale: resolved,
    siteName: await siteName(resolved),
  });
}

export default async function CategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('pages.categories');
  const tCatalog = await getTranslations('catalog');

  let tree;
  try {
    const service = await getCatalogService();
    tree = await service.getCategoryTree(locale);
  } catch (error) {
    // A catalogue outage must degrade to a stated error, not a blank page or a
    // crash that takes the whole shell with it.
    logger.exception(error);
    return (
      <PageShell title={t('heading')}>
        <ErrorState
          title={tCatalog('unavailableTitle')}
          description={tCatalog('unavailableDescription')}
        />
      </PageShell>
    );
  }

  if (tree.length === 0) {
    return (
      <PageShell title={t('heading')}>
        <EmptyState
          title={tCatalog('emptyCategoryTitle')}
          description={tCatalog('emptyCategoryDescription')}
        />
      </PageShell>
    );
  }

  return (
    <PageShell title={t('heading')}>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: tCatalog('breadcrumbHome'), url: canonicalUrl('/', locale) },
          { name: t('heading') },
        ])}
      />

      <div className="flex flex-col gap-8">
        {tree.map((category) => (
          <section key={category.id} aria-labelledby={`category-${category.slug}`}>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id={`category-${category.slug}`} className="text-base font-semibold">
                {category.name}
              </h2>
              <Link
                href={`/category/${category.slug}`}
                className="text-primary text-sm underline-offset-2 hover:underline"
              >
                {tCatalog('viewAll')}
              </Link>
            </div>

            {category.description && (
              <p className="text-muted-foreground mb-3 text-sm">{category.description}</p>
            )}

            {/* Only real children are tiled. A leaf category previously rendered a
                tile of ITSELF beneath its own heading, which duplicated the name
                on screen and for assistive tech; its "View all" link above is the
                affordance. */}
            {category.children.length > 0 && (
              <CategoryGrid
                categories={category.children}
                placeholderLabel={tCatalog('imagePlaceholder')}
              />
            )}
          </section>
        ))}
      </div>
    </PageShell>
  );
}
