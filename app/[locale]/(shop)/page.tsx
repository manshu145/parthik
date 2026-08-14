import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageShell, ShellPlaceholderNotice } from '@/components/layout/page-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * Home — SHELL ONLY.
 *
 * The real homepage is CMS-driven: section order, banners and visibility come from
 * `home_layouts` (master spec §9, D-30). That arrives with the CMS task. This page
 * proves the shell renders and routes correctly in both locales.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.home' });
  const tCommon = await getTranslations({ locale, namespace: 'common' });

  return { title: t('title'), description: tCommon('tagline') };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pages.home');
  const tShell = await getTranslations('shell');
  const tNav = await getTranslations('nav');

  return (
    <PageShell title={t('heading')}>
      <div className="flex flex-col gap-6">
        <ShellPlaceholderNotice label={tShell('placeholderNotice')} />

        {/* Quick links to the other shell surfaces, so navigation is exercisable
            without a catalogue. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              { href: '/categories', labelKey: 'categories' },
              { href: '/offers', labelKey: 'offers' },
              { href: '/cart', labelKey: 'cart' },
            ] as const
          ).map((link) => (
            <Card key={link.href}>
              <CardHeader>
                <CardTitle className="text-base">{tNav(link.labelKey)}</CardTitle>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" size="sm">
                  <Link href={link.href}>{tNav(link.labelKey)}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
