import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { readAdminVendorDetail } from '@/modules/admin-people';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('vendorDetail'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('vendor:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [{ vendor, documents, stores }, t, format] = await Promise.all([
    readAdminVendorDetail(id),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4" data-testid="admin-vendor-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{vendor.businessName}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{vendor.legalName ?? t('vendorDetail')}</p>
        </div>
        <Badge variant={statusVariant(vendor.status)}>{vendor.status.replaceAll('_', ' ')}</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="p-4 text-sm">
            <h2 className="font-semibold">{locale === 'hi' ? 'व्यवसाय' : 'Business'}</h2>
            <dl className="mt-3 grid gap-2">
              <Row label="Slug" value={vendor.slug} />
              <Row label="GSTIN" value={vendor.gstin ?? '—'} />
              <Row label="FSSAI" value={vendor.fssaiLicense ?? '—'} />
              <Row label={locale === 'hi' ? 'फोन' : 'Phone'} value={vendor.contactPhone ?? '—'} />
              <Row label="Email" value={vendor.contactEmail ?? '—'} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 text-sm">
            <h2 className="font-semibold">{locale === 'hi' ? 'समीक्षा' : 'Review'}</h2>
            <dl className="mt-3 grid gap-2">
              <Row label={locale === 'hi' ? 'आवेदन' : 'Applied'} value={format.dateTime(vendor.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} />
              <Row label={locale === 'hi' ? 'स्वीकृत' : 'Approved'} value={vendor.approvedAt ? format.dateTime(vendor.approvedAt, { dateStyle: 'medium' }) : '—'} />
              <Row label={locale === 'hi' ? 'निलंबित' : 'Suspended'} value={vendor.suspendedAt ? format.dateTime(vendor.suspendedAt, { dateStyle: 'medium' }) : '—'} />
            </dl>
            {(vendor.rejectionReason || vendor.suspensionReason) && (
              <p className="text-danger mt-3 text-sm">{vendor.rejectionReason ?? vendor.suspensionReason}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold">{locale === 'hi' ? 'स्टोर' : 'Stores'}</h2>
          {stores.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">{locale === 'hi' ? 'कोई store रिकॉर्ड नहीं है।' : 'No store records.'}</p>
          ) : (
            <ul className="mt-3 divide-y">
              {stores.map((store) => (
                <li key={store.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <div><p className="font-medium">{store.name}</p><p className="text-muted-foreground mt-1 text-xs">{[store.city, store.pincode].filter(Boolean).join(' · ') || '—'}</p></div>
                  <div className="flex items-center gap-2"><Badge variant={store.status === 'OPEN' ? 'success' : 'neutral'}>{store.status}</Badge><Badge variant={store.isAcceptingOrders ? 'success' : 'warning'}>{store.isAcceptingOrders ? 'ACCEPTING' : 'PAUSED'}</Badge></div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold">KYC</h2>
          {documents.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">{locale === 'hi' ? 'कोई document रिकॉर्ड नहीं है।' : 'No document records.'}</p>
          ) : (
            <ul className="mt-3 divide-y">
              {documents.map((document) => (
                <li key={document.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <div><p className="font-medium">{document.docType.replaceAll('_', ' ')}</p>{document.fileName && <p className="text-muted-foreground mt-1 text-xs">{document.fileName}</p>}{document.expiresAt && <p className="text-muted-foreground mt-1 text-xs">{format.dateTime(document.expiresAt, { dateStyle: 'medium' })}</p>}{document.rejectionReason && <p className="text-danger mt-1 text-xs">{document.rejectionReason}</p>}</div>
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

function kycVariant(status: string): BadgeVariant {
  if (status === 'APPROVED') return 'success';
  if (status === 'REJECTED') return 'danger';
  return 'warning';
}
