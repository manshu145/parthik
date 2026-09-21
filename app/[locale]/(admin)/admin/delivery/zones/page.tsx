import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { ZoneEditor } from '@/components/admin/master-data-editors';
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

      <ZoneEditor rows={zones} />
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
