import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('settings'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('setting:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const t = await getTranslations('adminNav');
  const isHindi = locale === 'hi';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-settings">
      <div>
        <h1 className="text-xl font-semibold">{t('settings')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {isHindi
            ? 'Platform configuration और runtime readiness के लिए central control panel।'
            : 'Central control panel for platform configuration and runtime readiness.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href={'/' + locale + '/admin/system-health'} className="block">
          <Card className="h-full transition-shadow hover:shadow-sm">
            <CardContent className="p-4">
              <h2 className="font-semibold">{isHindi ? 'System health' : 'System health'}</h2>
              <p className="text-muted-foreground mt-2 text-sm">
                {isHindi
                  ? 'Credentials दिखाए बिना database और provider readiness जांचें।'
                  : 'Check database and provider readiness without exposing credentials.'}
              </p>
              <p className="mt-3 text-sm font-medium">
                {isHindi ? 'Health dashboard खोलें →' : 'Open health dashboard →'}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href={'/' + locale + '/admin/settings/payments'} className="block">
          <Card className="h-full transition-shadow hover:shadow-sm">
            <CardContent className="p-4">
              <h2 className="font-semibold">
                {isHindi ? 'Integration settings' : 'Integration settings'}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm">
                {isHindi
                  ? 'Maps, Razorpay, Firebase और analytics provider configuration।'
                  : 'Maps, Razorpay, Firebase and analytics provider configuration.'}
              </p>
              <p className="mt-3 text-sm font-medium">
                {isHindi ? 'Integration settings खोलें →' : 'Open integration settings →'}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardContent className="p-4 text-sm">
          <p className="font-medium">
            {isHindi ? 'Sensitive credentials की अलग अनुमति जरूरी है।' : 'Sensitive credentials require a separate permission.'}
          </p>
          <p className="text-muted-foreground mt-1">
            {isHindi
              ? 'केवल setting:manage_sensitive अनुमति वाले administrators provider credentials देख और बदल सकते हैं। इस पेज पर कोई secret render नहीं होता।'
              : 'Only administrators with setting:manage_sensitive can manage provider credentials. This page does not render any secret values.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
