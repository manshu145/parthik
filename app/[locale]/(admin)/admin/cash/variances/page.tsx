import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { getCashService } from '@/modules/cash';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('cashVariances'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('cash:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const cash = await getCashService();
  const [rows, t, format] = await Promise.all([
    cash.variances(100),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  const totalVariancePaise = rows.reduce((total, row) => total + Math.abs(row.variancePaise), 0);
  const shortCollections = rows.filter((row) => row.variancePaise > 0).length;
  const overCollections = rows.filter((row) => row.variancePaise < 0).length;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-cash-variances">
      <div>
        <h1 className="text-xl font-semibold">{t('cashVariances')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Expected और collected COD के बीच सभी recorded differences की audit view।'
            : 'Audit view of every recorded difference between expected and collected COD.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label={locale === 'hi' ? 'कुल absolute variance' : 'Total absolute variance'}
          value={format.number(totalVariancePaise / 100, {
            style: 'currency',
            currency: 'INR',
          })}
        />
        <Metric
          label={locale === 'hi' ? 'कम collection' : 'Short collections'}
          value={shortCollections}
        />
        <Metric
          label={locale === 'hi' ? 'अधिक collection' : 'Over collections'}
          value={overCollections}
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'कोई COD variance recorded नहीं है।' : 'No COD variances recorded.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Driver</th>
                  <th className="px-4 py-3 font-medium">Expected</th>
                  <th className="px-4 py-3 font-medium">Collected</th>
                  <th className="px-4 py-3 font-medium">Variance</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Collected at</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={row.deliveryId} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{row.orderNumber}</td>
                    <td className="px-4 py-3">{row.driverName ?? '—'}</td>
                    <td className="px-4 py-3">
                      {row.expectedPaise === null
                        ? '—'
                        : format.number(row.expectedPaise / 100, {
                            style: 'currency',
                            currency: 'INR',
                          })}
                    </td>
                    <td className="px-4 py-3">
                      {row.collectedPaise === null
                        ? '—'
                        : format.number(row.collectedPaise / 100, {
                            style: 'currency',
                            currency: 'INR',
                          })}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {format.number(row.variancePaise / 100, {
                        style: 'currency',
                        currency: 'INR',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="warning">{row.variancePaise > 0 ? 'SHORT' : 'OVER'}</Badge>
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {row.collectedAt
                        ? format.dateTime(row.collectedAt, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-muted-foreground mt-1 text-xs">{label}</p>
      </CardContent>
    </Card>
  );
}
