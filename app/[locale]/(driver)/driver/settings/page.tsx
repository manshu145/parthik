import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AvailabilitySettings } from '@/components/driver/availability-settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { getDeliveryService } from '@/modules/delivery';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'driverNav' });

  return { title: t('settings'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const actor = await requireCurrentActor();
  const delivery = await getDeliveryService();
  const [driver, t] = await Promise.all([
    delivery.requireDriver(actor.userId),
    getTranslations('driverNav'),
  ]);
  const uiLocale = locale === 'hi' ? 'hi' : 'en';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" data-testid="driver-settings">
      <div>
        <h1 className="text-xl font-semibold">{t('settings')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {uiLocale === 'hi'
            ? 'अपनी काम की उपलब्धता और ड्राइवर अकाउंट के मुख्य हिस्से नियंत्रित करें।'
            : 'Control your work availability and access the key parts of your driver account.'}
        </p>
      </div>

      <AvailabilitySettings initialAvailability={driver.availability} locale={uiLocale} />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div>
            <p className="font-medium">{uiLocale === 'hi' ? 'अकाउंट' : 'Account'}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {uiLocale === 'hi'
                ? 'प्रोफ़ाइल विवरण और KYC दस्तावेज़ स्थिति देखें।'
                : 'Review your profile details and KYC document status.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href="/driver/profile">{t('profile')}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/driver/documents">{t('documents')}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/driver/support">{t('support')}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
