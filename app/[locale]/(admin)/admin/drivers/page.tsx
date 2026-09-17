import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminDrivers } from '@/modules/admin-people';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('drivers'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('driver:list');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [drivers, t, format] = await Promise.all([
    listAdminDrivers(),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-drivers">
      <div>
        <h1 className="text-xl font-semibold">{t('drivers')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi' ? 'Driver applications, availability और delivery performance.' : 'Driver applications, availability and delivery performance.'}
        </p>
      </div>

      {drivers.length === 0 ? (
        <Card><CardContent className="p-4 text-sm">{locale === 'hi' ? 'अभी कोई driver नहीं है।' : 'No drivers yet.'}</CardContent></Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Driver</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'स्थिति' : 'Status'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'उपलब्धता' : 'Availability'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'डिलीवरी' : 'Deliveries'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'बनाया गया' : 'Created'}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {drivers.map((driver) => (
                  <tr key={driver.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link href={`/admin/drivers/${driver.id}`} className="font-medium hover:underline">{driver.fullName}</Link>
                      <p className="text-muted-foreground mt-1 text-xs">{driver.driverCode} · {driver.phone}</p>
                    </td>
                    <td className="px-4 py-3"><Badge variant={driverStatusVariant(driver.status)}>{driver.status.replaceAll('_', ' ')}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={availabilityVariant(driver.availability)}>{driver.availability.replaceAll('_', ' ')}</Badge></td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{driver.successfulDeliveries}/{driver.totalDeliveries}</p>
                      {driver.ratingAvg && <p className="text-muted-foreground mt-1 text-xs">★ {driver.ratingAvg}</p>}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">{format.dateTime(driver.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function driverStatusVariant(status: string): BadgeVariant {
  if (status === 'APPROVED') return 'success';
  if (status === 'REJECTED' || status === 'SUSPENDED') return 'danger';
  return 'warning';
}

function availabilityVariant(value: string): BadgeVariant {
  if (value === 'ONLINE') return 'success';
  if (value === 'ON_DELIVERY') return 'primary';
  if (value === 'ON_BREAK') return 'warning';
  return 'neutral';
}
