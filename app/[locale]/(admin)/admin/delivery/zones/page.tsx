import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminDeliveryZones } from '@/modules/admin-configuration';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('zones'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('zone:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [zones, t, format] = await Promise.all([
    listAdminDeliveryZones(),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-delivery-zones">
      <div>
        <h1 className="text-xl font-semibold">{t('zones')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Serviceability, pincode coverage और delivery fee configuration का live overview।'
            : 'Live overview of serviceability, pincode coverage and delivery fee configuration.'}
        </p>
      </div>

      {zones.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">No delivery zones configured.</CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Zone</th>
                  <th className="px-4 py-3 font-medium">Coverage</th>
                  <th className="px-4 py-3 font-medium">Base fee</th>
                  <th className="px-4 py-3 font-medium">Free above</th>
                  <th className="px-4 py-3 font-medium">Minimum order</th>
                  <th className="px-4 py-3 font-medium">Per km</th>
                  <th className="px-4 py-3 font-medium">ETA</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {zones.map((zone) => (
                  <tr key={zone.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium">{zone.name}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {zone.code} · {zone.city}, {zone.state}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <p>{zone.pincodeCount} active pincodes</p>
                      <p className="text-muted-foreground mt-1">
                        {zone.radiusKm ? `${zone.radiusKm} km radius` : 'Radius not set'}
                      </p>
                    </td>
                    <MoneyCell value={zone.baseDeliveryFeePaise} format={format} />
                    <MoneyCell value={zone.freeDeliveryThresholdPaise} format={format} />
                    <MoneyCell value={zone.minOrderPaise} format={format} />
                    <MoneyCell value={zone.perKmFeePaise} format={format} />
                    <td className="px-4 py-3">{zone.avgDeliveryMinutes ? `${zone.avgDeliveryMinutes} min` : '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={zone.isActive ? 'success' : 'neutral'}>
                        {zone.isActive ? 'ACTIVE' : 'INACTIVE'}
                      </Badge>
                    </td>
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

function MoneyCell({
  value,
  format,
}: {
  value: number | null;
  format: Awaited<ReturnType<typeof getFormatter>>;
}) {
  return (
    <td className="px-4 py-3">
      {value === null
        ? '—'
        : format.number(value / 100, {
            style: 'currency',
            currency: 'INR',
          })}
    </td>
  );
}
