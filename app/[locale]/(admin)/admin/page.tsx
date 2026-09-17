import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { readAdminDashboard } from '@/modules/admin-dashboard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });

  return { title: t('dashboard'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('dashboard:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [snapshot, t] = await Promise.all([
    readAdminDashboard(),
    getTranslations('adminNav'),
  ]);

  const currency = new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

  const metrics = [
    {
      label: locale === 'hi' ? 'कुल ऑर्डर' : 'Total orders',
      value: snapshot.totalOrders.toLocaleString(locale === 'hi' ? 'hi-IN' : 'en-IN'),
      detail: `${snapshot.openOrders} ${locale === 'hi' ? 'खुले' : 'open'}`,
    },
    {
      label: locale === 'hi' ? 'डिलीवर किए गए' : 'Delivered orders',
      value: snapshot.deliveredOrders.toLocaleString(locale === 'hi' ? 'hi-IN' : 'en-IN'),
      detail: currency.format(snapshot.grossDeliveredPaise / 100),
    },
    {
      label: locale === 'hi' ? 'स्वीकृत विक्रेता' : 'Approved vendors',
      value: snapshot.approvedVendors.toLocaleString(locale === 'hi' ? 'hi-IN' : 'en-IN'),
      detail: `${snapshot.pendingVendors} ${locale === 'hi' ? 'समीक्षा में' : 'pending review'}`,
    },
    {
      label: locale === 'hi' ? 'स्वीकृत ड्राइवर' : 'Approved drivers',
      value: snapshot.approvedDrivers.toLocaleString(locale === 'hi' ? 'hi-IN' : 'en-IN'),
      detail: `${snapshot.onlineDrivers} ${locale === 'hi' ? 'ऑनलाइन' : 'online'}`,
    },
    {
      label: locale === 'hi' ? 'सक्रिय उत्पाद' : 'Active products',
      value: snapshot.activeProducts.toLocaleString(locale === 'hi' ? 'hi-IN' : 'en-IN'),
      detail: `${snapshot.lowStockItems} ${locale === 'hi' ? 'कम स्टॉक' : 'low stock'}`,
    },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5" data-testid="admin-dashboard">
      <div>
        <h1 className="text-xl font-semibold">{t('dashboard')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'ऑर्डर, विक्रेता, ड्राइवर, कैटलॉग और स्टॉक की लाइव ऑपरेशनल स्थिति।'
            : 'Live operational status across orders, vendors, drivers, catalog and stock.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardContent className="p-4">
              <p className="text-muted-foreground text-xs">{metric.label}</p>
              <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
              <p className="text-muted-foreground mt-1 text-xs">{metric.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4 text-sm">
          <p className="font-medium">
            {locale === 'hi' ? 'Production KPI boundary' : 'Production KPI boundary'}
          </p>
          <p className="text-muted-foreground mt-1">
            {locale === 'hi'
              ? 'यह डैशबोर्ड केवल स्वीकृत ऑपरेशनल स्टेट्स दिखाता है। टैक्स और automated settlement KPIs D-14/D-15 तय होने तक जानबूझकर शामिल नहीं हैं।'
              : 'This dashboard only reports approved operational states. Tax and automated settlement KPIs stay intentionally excluded until D-14/D-15 are decided.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
