import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { getPublicAppEnv } from '@/lib/config/public-config';

/**
 * Foundation landing page.
 *
 * TASK 001 deliberately ships NO commerce UI. This page exists to prove the
 * scaffold works end to end — rendering, i18n in both locales, design tokens and
 * the component foundation — and it will be replaced by the real CMS-driven
 * homepage in TASK 004/006.
 */

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('foundation');
  const tCommon = await getTranslations('common');
  const appEnv = getPublicAppEnv();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tCommon('appName')}</h1>
          <p className="text-muted-foreground text-sm">{tCommon('tagline')}</p>
        </div>
        <LocaleSwitcher label={tCommon('changeLanguage')} />
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('status')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{t('environmentLabel')}</dt>
              <dd className="font-medium">{appEnv}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('localeLabel')}</dt>
              <dd className="font-medium">{locale}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">{t('docsHint')}</p>
    </main>
  );
}
