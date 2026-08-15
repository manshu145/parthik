import type { Metadata } from 'next';
import { MarketingPage, marketingMetadata } from '../_marketing-page';

/**
 * `/driver-registration` (docs/ROUTES.md §3).
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
  return marketingMetadata('driver-registration', locale);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <MarketingPage slug="driver-registration" localeParam={locale} />;
}
