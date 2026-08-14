import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageShell, ShellPlaceholderNotice } from '@/components/layout/page-shell';
import { EmptyState } from '@/components/feedback/states';

/**
 * Product detail — SHELL ONLY (docs/ROUTES.md §4).
 *
 * Product JSON-LD is deliberately NOT emitted yet. Structured data must reflect
 * real price and availability, and advertising stock we do not have would be both
 * an SEO and a trust problem (docs/ROUTES.md §11). It arrives with the catalogue.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.product' });

  return { title: `${t('title')}: ${slug}` };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const tShell = await getTranslations('shell');

  return (
    <PageShell title={slug}>
      <div className="flex flex-col gap-6">
        <ShellPlaceholderNotice label={tShell('placeholderNotice')} />
        <EmptyState
          title={tShell('notImplementedTitle')}
          description={tShell('notImplementedDescription')}
        />
      </div>
    </PageShell>
  );
}
