import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { ZoneEditor } from '@/components/admin/master-data-editors';
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

  const [zones, t] = await Promise.all([
    listAdminDeliveryZones(),
    getTranslations('adminNav'),
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
