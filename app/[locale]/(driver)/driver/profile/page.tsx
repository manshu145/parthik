import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { getDeliveryService } from '@/modules/delivery';

/** Read-only driver identity/profile view. */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'driverNav' });

  return { title: t('profile'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const actor = await requireCurrentActor();
  const service = await getDeliveryService();
  const [driver, t] = await Promise.all([
    service.requireDriver(actor.userId),
    getTranslations('driverNav'),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" data-testid="driver-profile">
      <h1 className="text-xl font-semibold">{t('profile')}</h1>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div>
            <p className="text-lg font-semibold">{driver.fullName}</p>
            <p className="text-muted-foreground text-sm">{driver.phone}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant={driver.status === 'APPROVED' ? 'success' : 'warning'}>
              {driver.status.replaceAll('_', ' ')}
            </Badge>
            <Badge>{driver.availability.replaceAll('_', ' ')}</Badge>
          </div>

          <p className="text-muted-foreground text-sm">{driver.driverCode}</p>
        </CardContent>
      </Card>
    </div>
  );
}
