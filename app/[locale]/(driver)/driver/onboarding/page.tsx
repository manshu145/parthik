import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { getDeliveryService } from '@/modules/delivery';
import { getDriverDocumentsForUser } from '@/modules/driver-documents';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'driverNav' });

  return { title: t('onboarding'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const actor = await requireCurrentActor();
  const delivery = await getDeliveryService();
  const [driver, documents, t, format] = await Promise.all([
    delivery.requireDriver(actor.userId),
    getDriverDocumentsForUser(actor.userId),
    getTranslations('driverNav'),
    getFormatter(),
  ]);

  const expiredDocuments = documents.filter((document) => document.isExpired);
  const approvedDocuments = documents.filter((document) => document.kycStatus === 'APPROVED');
  const rejectedDocuments = documents.filter((document) => document.kycStatus === 'REJECTED');
  const documentsNeedingAttention = documents.filter(
    (document) => document.isExpired || document.kycStatus !== 'APPROVED'
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" data-testid="driver-onboarding">
      <div>
        <h1 className="text-xl font-semibold">{t('onboarding')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'अपनी आवेदन स्थिति और KYC दस्तावेज़ों की प्रगति देखें।'
            : 'Track your application status and KYC document progress.'}
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{driver.fullName}</p>
              <p className="text-muted-foreground text-sm">{driver.driverCode}</p>
            </div>
            <Badge variant={driverStatusVariant(driver.status)}>
              {driver.status.replaceAll('_', ' ')}
            </Badge>
          </div>

          <p className="text-muted-foreground text-sm">
            {driver.status !== 'APPROVED'
              ? locale === 'hi'
                ? 'आपकी ड्राइवर प्रोफ़ाइल अभी समीक्षा या कार्रवाई की स्थिति में है। नीचे दर्ज KYC स्थिति देखें।'
                : 'Your driver profile is still under review or requires action. Check the recorded KYC status below.'
              : documents.length === 0
                ? locale === 'hi'
                  ? 'प्रोफ़ाइल स्वीकृत है। अभी कोई KYC दस्तावेज़ रिकॉर्ड यहाँ उपलब्ध नहीं है।'
                  : 'Profile is approved. No KYC document records are currently available here.'
                : documentsNeedingAttention.length > 0
                  ? locale === 'hi'
                    ? 'प्रोफ़ाइल स्वीकृत है, लेकिन कुछ दर्ज KYC दस्तावेज़ों पर अभी ध्यान देने की आवश्यकता है।'
                    : 'Profile is approved, but some recorded KYC documents still need attention.'
                  : locale === 'hi'
                    ? 'प्रोफ़ाइल स्वीकृत है और दर्ज KYC दस्तावेज़ वर्तमान हैं।'
                    : 'Profile is approved and the recorded KYC documents are current.'}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label={locale === 'hi' ? 'स्वीकृत दस्तावेज़' : 'Approved documents'}
          value={approvedDocuments.length}
        />
        <MetricCard
          label={locale === 'hi' ? 'अस्वीकृत दस्तावेज़' : 'Rejected documents'}
          value={rejectedDocuments.length}
        />
        <MetricCard
          label={locale === 'hi' ? 'समाप्त दस्तावेज़' : 'Expired documents'}
          value={expiredDocuments.length}
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold">{locale === 'hi' ? 'KYC चेकलिस्ट' : 'KYC checklist'}</h2>

          {documents.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">
              {locale === 'hi'
                ? 'अभी कोई KYC दस्तावेज़ रिकॉर्ड नहीं है। सुरक्षित private-upload flow अलग से जोड़ा जाएगा।'
                : 'No KYC documents are recorded yet. The secure private-upload flow will be added separately.'}
            </p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y">
              {documents.map((document) => (
                <li
                  key={document.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{document.docType.replaceAll('_', ' ')}</p>
                    {document.fileName && (
                      <p className="text-muted-foreground mt-1 truncate text-xs">
                        {document.fileName}
                      </p>
                    )}
                    {document.expiresAt && (
                      <p
                        className={
                          document.isExpired
                            ? 'text-danger mt-1 text-xs'
                            : 'text-muted-foreground mt-1 text-xs'
                        }
                      >
                        {document.isExpired
                          ? locale === 'hi'
                            ? 'समाप्त'
                            : 'Expired'
                          : locale === 'hi'
                            ? 'समाप्ति'
                            : 'Expires'}
                        : {format.dateTime(document.expiresAt, { dateStyle: 'medium' })}
                      </p>
                    )}
                    {document.rejectionReason && (
                      <p className="text-danger mt-1 text-xs">{document.rejectionReason}</p>
                    )}
                  </div>

                  <Badge variant={documentStatusVariant(document.kycStatus, document.isExpired)}>
                    {document.isExpired ? 'EXPIRED' : document.kycStatus.replaceAll('_', ' ')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-muted-foreground mt-1 text-xs">{label}</p>
      </CardContent>
    </Card>
  );
}

function driverStatusVariant(status: string): BadgeVariant {
  if (status === 'APPROVED') return 'success';
  if (status === 'REJECTED' || status === 'SUSPENDED') return 'danger';
  return 'warning';
}

function documentStatusVariant(status: string, expired: boolean): BadgeVariant {
  if (expired || status === 'REJECTED') return 'danger';
  if (status === 'APPROVED') return 'success';
  return 'warning';
}
