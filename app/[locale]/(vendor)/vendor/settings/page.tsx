import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { requireSurface } from '@/lib/auth/current-actor';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });
  return { title: t('settings'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSurface('vendor');

  const t = await getTranslations('vendorNav');
  const items = [
    {
      href: `/${locale}/vendor/store`,
      title: locale === 'hi' ? 'Store configuration' : 'Store configuration',
      description:
        locale === 'hi'
          ? 'Store status, COD, minimum order, delivery radius और operational configuration देखें।'
          : 'Review store status, COD, minimum order, delivery radius and operational configuration.',
    },
    {
      href: `/${locale}/vendor/documents`,
      title: locale === 'hi' ? 'KYC और documents' : 'KYC and documents',
      description:
        locale === 'hi'
          ? 'Submitted documents, review status, expiry और rejection reasons देखें।'
          : 'Review submitted documents, review status, expiry and rejection reasons.',
    },
    {
      href: `/${locale}/vendor/onboarding`,
      title: locale === 'hi' ? 'Onboarding status' : 'Onboarding status',
      description:
        locale === 'hi'
          ? 'Vendor approval readiness और onboarding checklist देखें।'
          : 'Review vendor approval readiness and the onboarding checklist.',
    },
    {
      href: `/${locale}/vendor/support`,
      title: locale === 'hi' ? 'Support' : 'Support',
      description:
        locale === 'hi'
          ? 'Account या operations से जुड़ी support activity देखें।'
          : 'Review support activity related to the account or operations.',
    },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4" data-testid="vendor-settings">
      <div>
        <h1 className="text-xl font-semibold">{t('settings')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Vendor account और operational configuration के लिए सुरक्षित settings hub।'
            : 'Secure settings hub for vendor account and operational configuration.'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="block focus:outline-none">
            <Card className="h-full transition-shadow hover:shadow-sm">
              <CardContent className="p-4">
                <h2 className="font-semibold">{item.title}</h2>
                <p className="text-muted-foreground mt-2 text-sm leading-5">{item.description}</p>
                <p className="mt-3 text-sm font-medium">{locale === 'hi' ? 'खोलें →' : 'Open →'}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        {locale === 'hi'
          ? 'Bank settlement और multi-store management के write controls D-15 / D-32 final होने तक intentionally disabled हैं।'
          : 'Bank settlement and multi-store management write controls remain intentionally disabled until D-15 / D-32 are final.'}
      </p>
    </div>
  );
}
