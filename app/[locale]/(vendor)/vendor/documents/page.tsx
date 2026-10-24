import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { vendorScopeIdsFor } from '@/modules/identity';
import { getVendorOnboarding } from '@/modules/vendor-onboarding';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });

  return { title: t('documents'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const actor = await requireCurrentActor();
  const vendorId = vendorScopeIdsFor(actor)[0];
  if (!vendorId) notFound();

  const [{ documents }, t, format] = await Promise.all([
    getVendorOnboarding(vendorId),
    getTranslations('vendorNav'),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" data-testid="vendor-documents">
      <div>
        <h1 className="text-xl font-semibold">{t('documents')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'अपने KYC दस्तावेज़ों की समीक्षा और expiry स्थिति देखें।'
            : 'Review the verification and expiry status of your KYC documents.'}
        </p>
      </div>

      {documents.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            <p className="font-medium">
              {locale === 'hi' ? 'अभी कोई KYC दस्तावेज़ रिकॉर्ड नहीं है।' : 'No KYC documents yet.'}
            </p>
            <p className="text-muted-foreground mt-1">
              {locale === 'hi'
                ? 'Private R2 provisioning के बाद सुरक्षित upload flow जोड़ा जाएगा।'
                : 'A secure upload flow will be added after private R2 is provisioned.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {documents.map((document) => (
            <li key={document.id}>
              <Card>
                <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">{document.docType.replaceAll('_', ' ')}</p>
                    {document.fileName && (
                      <p className="text-muted-foreground mt-1 truncate text-sm">
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
                      <p className="text-danger mt-2 text-sm">{document.rejectionReason}</p>
                    )}
                  </div>

                  <Badge variant={statusVariant(document.kycStatus, document.isExpired)}>
                    {document.isExpired ? 'EXPIRED' : document.kycStatus.replaceAll('_', ' ')}
                  </Badge>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function statusVariant(status: string, expired: boolean): BadgeVariant {
  if (expired || status === 'REJECTED') return 'danger';
  if (status === 'APPROVED') return 'success';
  return 'warning';
}
