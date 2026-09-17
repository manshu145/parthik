import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkVendorPage } from '@/lib/auth/vendor-page';
import { readVendorStoreSummary } from '@/modules/vendor-operations';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });
  return { title: t('store'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkVendorPage('product:view');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;

  const [summary, t, format] = await Promise.all([
    readVendorStoreSummary(access.vendorId),
    getTranslations('vendorNav'),
    getFormatter(),
  ]);

  if (!summary) {
    return (
      <Card>
        <CardContent className="p-4 text-sm">Vendor account could not be found.</CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="vendor-store-overview">
      <div>
        <h1 className="text-xl font-semibold">{t('store')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Vendor और store configuration का live read-only overview। Store management UX D-32 final होने तक edit actions disabled हैं।'
            : 'Live read-only overview of vendor and store configuration. Store edit actions remain disabled until D-32 is final.'}
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Business" value={summary.vendor.businessName} />
          <Field label="Legal name" value={summary.vendor.legalName ?? '—'} />
          <Field label="Vendor status" value={summary.vendor.status} />
          <Field
            label="Contact"
            value={summary.vendor.contactPhone ?? summary.vendor.contactEmail ?? '—'}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {summary.stores.map((store) => (
          <Card key={store.id}>
            <CardContent className="p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{store.name}</h2>
                  <p className="text-muted-foreground mt-1 text-xs">/{store.slug}</p>
                </div>
                <Badge variant={store.status === 'OPEN' ? 'success' : 'neutral'}>
                  {store.status}
                </Badge>
              </div>

              {store.description ? (
                <p className="text-muted-foreground mt-3">{store.description}</p>
              ) : null}

              <dl className="mt-4 grid gap-2">
                <Row label="Accepting orders" value={store.isAcceptingOrders ? 'YES' : 'NO'} />
                <Row label="COD" value={store.codEnabled ? 'ENABLED' : 'DISABLED'} />
                <Row
                  label="Minimum order"
                  value={format.number(store.minOrderPaise / 100, {
                    style: 'currency',
                    currency: 'INR',
                  })}
                />
                <Row
                  label="Preparation time"
                  value={store.avgPrepTimeMinutes ? `${store.avgPrepTimeMinutes} min` : '—'}
                />
                <Row
                  label="Delivery radius"
                  value={store.deliveryRadiusKm ? `${store.deliveryRadiusKm} km` : '—'}
                />
                <Row
                  label="Address"
                  value={[store.city, store.state, store.pincode].filter(Boolean).join(', ') || '—'}
                />
                <Row
                  label="Rating"
                  value={store.ratingAvg ? `${store.ratingAvg} (${store.ratingCount})` : '—'}
                />
                <Row
                  label="Closed until"
                  value={
                    store.closedUntil
                      ? format.dateTime(store.closedUntil, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : '—'
                  }
                />
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>

      {summary.stores.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            No stores are linked to this vendor yet.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="max-w-[65%] text-right font-medium">{value}</dd>
    </div>
  );
}
