import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { NotFoundError } from '@/lib/errors';
import { getDeliveryProofForDriverUser } from '@/modules/delivery-proof';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'driverNav' });

  return { title: t('proof'), robots: { index: false, follow: false } };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; deliveryId: string }>;
}) {
  const { locale, deliveryId } = await params;
  setRequestLocale(locale);

  const actor = await requireCurrentActor();
  const view = await getDeliveryProofForDriverUser(actor.userId, deliveryId).catch(
    (error: unknown) => {
      // A missing delivery and another driver's delivery are intentionally indistinguishable.
      if (error instanceof NotFoundError) notFound();
      throw error;
    }
  );
  const [t, format] = await Promise.all([getTranslations('driverNav'), getFormatter()]);

  const exceptionProofs = view.proofs.filter((proof) => proof.proofType !== 'OTP');

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" data-testid="driver-proof-status">
      <div>
        <h1 className="text-xl font-semibold">{t('proof')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'इस डिलीवरी की OTP और proof स्थिति देखें। निजी evidence files यहाँ प्रदर्शित नहीं होतीं।'
            : 'Review the OTP and proof status for this delivery. Private evidence files are not exposed here.'}
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {locale === 'hi' ? 'डिलीवरी स्थिति' : 'Delivery status'}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">{view.delivery.id}</p>
            </div>
            <Badge variant={deliveryStatusVariant(view.delivery.status)}>
              {view.delivery.status.replaceAll('_', ' ')}
            </Badge>
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <Metric
              label={locale === 'hi' ? 'OTP attempts' : 'OTP attempts'}
              value={view.delivery.otpAttempts}
            />
            <Metric
              label={locale === 'hi' ? 'OTP regenerated' : 'OTP regenerated'}
              value={view.delivery.otpRegeneratedCount}
            />
            <Metric
              label={locale === 'hi' ? 'Proof records' : 'Proof records'}
              value={view.proofs.length}
            />
          </div>

          <p className="text-muted-foreground text-sm">
            {view.delivery.otpVerifiedAt
              ? `${locale === 'hi' ? 'OTP verified' : 'OTP verified'}: ${format.dateTime(
                  view.delivery.otpVerifiedAt,
                  { dateStyle: 'medium', timeStyle: 'short' }
                )}`
              : locale === 'hi'
                ? 'OTP अभी verify नहीं हुआ है।'
                : 'OTP has not been verified yet.'}
          </p>

          {view.delivery.deliveredAt && (
            <p className="text-muted-foreground text-sm">
              {locale === 'hi' ? 'Delivered' : 'Delivered'}:{' '}
              {format.dateTime(view.delivery.deliveredAt, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
          )}

          {view.delivery.failedAt && (
            <p className="text-danger text-sm">
              {view.delivery.failureReason ??
                (locale === 'hi' ? 'डिलीवरी असफल रही।' : 'Delivery failed.')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">
              {locale === 'hi' ? 'Recorded proof' : 'Recorded proof'}
            </h2>
            {exceptionProofs.length > 0 && (
              <Badge variant="warning">
                {locale === 'hi' ? 'Exception proof used' : 'Exception proof used'}
              </Badge>
            )}
          </div>

          {view.proofs.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">
              {locale === 'hi'
                ? 'अभी कोई proof record उपलब्ध नहीं है।'
                : 'No proof record is available yet.'}
            </p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y">
              {view.proofs.map((proof) => (
                <li
                  key={proof.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="font-medium">{proof.proofType.replaceAll('_', ' ')}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {format.dateTime(proof.capturedAt ?? proof.createdAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                  <Badge variant={proof.otpVerified ? 'success' : 'neutral'}>
                    {proof.otpVerified
                      ? locale === 'hi'
                        ? 'OTP VERIFIED'
                        : 'OTP VERIFIED'
                      : proof.proofType === 'OTP'
                        ? locale === 'hi'
                          ? 'RECORDED'
                          : 'RECORDED'
                        : locale === 'hi'
                          ? 'EXCEPTION'
                          : 'EXCEPTION'}
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="font-semibold">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs">{label}</p>
    </div>
  );
}

function deliveryStatusVariant(status: string): BadgeVariant {
  if (status === 'DELIVERED') return 'success';
  if (status === 'FAILED' || status === 'CANCELLED') return 'danger';
  return 'warning';
}
