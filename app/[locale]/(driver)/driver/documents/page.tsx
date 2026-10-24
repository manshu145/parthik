import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { getDriverDocumentsForUser } from '@/modules/driver-documents';

/**
 * Driver document/KYC status — read-only until private R2 upload is provisioned.
 *
 * The read model intentionally excludes private storage keys and encrypted document numbers.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'driverNav' });

  return { title: t('documents'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const actor = await requireCurrentActor();
  const [documents, t, tEmpty, format] = await Promise.all([
    getDriverDocumentsForUser(actor.userId),
    getTranslations('driverNav'),
    getTranslations('states.empty'),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" data-testid="driver-documents">
      <h1 className="text-xl font-semibold">{t('documents')}</h1>

      {documents.length === 0 ? (
        <Card>
          <CardContent className="p-4">
            <p className="font-medium">{tEmpty('title')}</p>
            <p className="text-muted-foreground mt-1 text-sm">{tEmpty('description')}</p>
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
                      <p className="text-muted-foreground mt-1 text-xs">
                        {format.dateTime(document.expiresAt, { dateStyle: 'medium' })}
                      </p>
                    )}
                    {document.rejectionReason && (
                      <p className="text-danger mt-2 text-sm">{document.rejectionReason}</p>
                    )}
                  </div>

                  <Badge variant={statusVariant(document.kycStatus)}>
                    {document.kycStatus.replaceAll('_', ' ')}
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

function statusVariant(status: string): BadgeVariant {
  if (status === 'APPROVED') return 'success';
  if (status === 'REJECTED') return 'danger';
  if (status === 'PENDING' || status === 'UNDER_REVIEW') return 'warning';
  return 'neutral';
}
