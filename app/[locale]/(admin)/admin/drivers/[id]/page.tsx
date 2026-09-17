import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { readAdminDriverDetail } from '@/modules/admin-people';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('driverDetail'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('driver:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [{ driver, documents }, t, format] = await Promise.all([
    readAdminDriverDetail(id),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4" data-testid="admin-driver-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{driver.fullName}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{driver.driverCode} · {t('driverDetail')}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant={statusVariant(driver.status)}>{driver.status.replaceAll('_', ' ')}</Badge>
          <Badge variant={availabilityVariant(driver.availability)}>{driver.availability.replaceAll('_', ' ')}</Badge>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="p-4 text-sm">
            <h2 className="font-semibold">{locale === 'hi' ? 'प्रोफ़ाइल' : 'Profile'}</h2>
            <dl className="mt-3 grid gap-2">
              <Row label={locale === 'hi' ? 'फोन' : 'Phone'} value={driver.phone} />
              <Row label={locale === 'hi' ? 'जन्म तिथि' : 'Date of birth'} value={driver.dateOfBirth ?? '—'} />
              <Row label={locale === 'hi' ? 'आपात संपर्क' : 'Emergency contact'} value={driver.emergencyContact ?? '—'} />
              <Row label={locale === 'hi' ? 'रेटिंग' : 'Rating'} value={driver.ratingAvg ? `${driver.ratingAvg} (${driver.ratingCount})` : '—'} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 text-sm">
            <h2 className="font-semibold">{locale === 'hi' ? 'ऑपरेशंस' : 'Operations'}</h2>
            <dl className="mt-3 grid gap-2">
              <Row label={locale === 'hi' ? 'कुल डिलीवरी' : 'Total deliveries'} value={String(driver.totalDeliveries)} />
              <Row label={locale === 'hi' ? 'सफल डिलीवरी' : 'Successful deliveries'} value={String(driver.successfulDeliveries)} />
              <Row label={locale === 'hi' ? 'स्वीकृत' : 'Approved'} value={driver.approvedAt ? format.dateTime(driver.approvedAt, { dateStyle: 'medium' }) : '—'} />
              <Row label={locale === 'hi' ? 'बनाया गया' : 'Created'} value={format.dateTime(driver.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} />
            </dl>
            {driver.rejectionReason && <p className="text-danger mt-3 text-sm">{driver.rejectionReason}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold">KYC</h2>
          {documents.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">{locale === 'hi' ? 'कोई document रिकॉर्ड नहीं है।' : 'No document records.'}</p>
          ) : (
            <ul className="mt-3 divide-y">
              {documents.map((document) => (
                <li key={document.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium">{document.docType.replaceAll('_', ' ')}</p>
                    {document.fileName && <p className="text-muted-foreground mt-1 text-xs">{document.fileName}</p>}
                    {document.expiresAt && <p className="text-muted-foreground mt-1 text-xs">{format.dateTime(document.expiresAt, { dateStyle: 'medium' })}</p>}
                    {document.rejectionReason && <p className="text-danger mt-1 text-xs">{document.rejectionReason}</p>}
                  </div>
                  <Badge variant={kycVariant(document.kycStatus)}>{document.kycStatus}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>;
}

function statusVariant(status: string): BadgeVariant {
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

function kycVariant(status: string): BadgeVariant {
  if (status === 'APPROVED') return 'success';
  if (status === 'REJECTED') return 'danger';
  return 'warning';
}
