import type { Metadata } from 'next';
import { MarketingPage, marketingMetadata } from '../_marketing-page';

/**
 * `/cancellation-policy` (docs/ROUTES.md §3).
 *
 * A real route folder rather than a `[slug]` param, so an unknown path still gets a
 * genuine 404 — see `_marketing-page.tsx` for why that matters. Content is
 * CMS-managed and shared by all twelve pages.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata('cancellation-policy', locale);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <MarketingPage slug="cancellation-policy" localeParam={locale} />;
}
