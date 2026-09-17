import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
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
  return { title: t('cashDeposits'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('cash:reconcile');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const cash = await getCashService();
  const [declared, verified, partial, rejected, t, format] = await Promise.all([
    cash.verificationQueue('DECLARED', 100),
    cash.verificationQueue('VERIFIED', 50),
    cash.verificationQueue('PARTIAL', 50),
    cash.verificationQueue('REJECTED', 50),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  const rows = [...declared, ...partial, ...verified, ...rejected].sort(
    (a, b) => b.declaredAt.getTime() - a.declaredAt.getTime()
  );
  const pendingPaise = declared.reduce(
    (total, row) => total + Number(row.declaredAmountPaise),
    0
  );
  const variancePaise = partial.reduce(
    (total, row) => total + Math.abs(Number(row.variancePaise ?? 0)),
    0
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-cash-deposits">
      <div>
        <h1 className="text-xl font-semibold">{t('cashDeposits')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Driver cash deposit declarations, verification और discrepancies की operational queue।'
            : 'Operational queue for driver cash deposit declarations, verification and discrepancies.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label={locale === 'hi' ? 'सत्यापन लंबित' : 'Awaiting verification'} value={declared.length} />
        <Metric
          label={locale === 'hi' ? 'लंबित राशि' : 'Pending declared amount'}
          value={format.number(pendingPaise / 100, { style: 'currency', currency: 'INR' })}
        />
        <Metric
          label={locale === 'hi' ? 'आंशिक अंतर' : 'Partial variance'}
          value={format.number(variancePaise / 100, { style: 'currency', currency: 'INR' })}
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'अभी कोई cash deposit record नहीं है।' : 'No cash deposit records yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Driver</th>
                  <th className="px-4 py-3 font-medium">Declared</th>
                  <th className="px-4 py-3 font-medium">Verified</th>
                  <th className="px-4 py-3 font-medium">Variance</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Declared at</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.driverName}</p>
                      <p className="text-muted-foreground mt-1 text-xs">{row.driverCode}</p>
                    </td>
                    <td className="px-4 py-3">
                      {format.number(Number(row.declaredAmountPaise) / 100, {
                        style: 'currency',
                        currency: 'INR',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      {row.verifiedAmountPaise === null
                        ? '—'
                        : format.number(Number(row.verifiedAmountPaise) / 100, {
                            style: 'currency',
                            currency: 'INR',
                          })}
                    </td>
                    <td className="px-4 py-3">
                      {row.variancePaise === null
                        ? '—'
                        : format.number(Number(row.variancePaise) / 100, {
                            style: 'currency',
                            currency: 'INR',
                          })}
                    </td>
                    <td className="px-4 py-3">{row.method.replaceAll('_', ' ')}</td>
                    <td className="px-4 py-3">
                      <Badge variant={depositStatusVariant(row.status)}>{row.status}</Badge>
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">{row.reference}</td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {format.dateTime(row.declaredAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
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

function depositStatusVariant(status: string): BadgeVariant {
  if (status === 'VERIFIED') return 'success';
  if (status === 'REJECTED') return 'danger';
  if (status === 'DECLARED' || status === 'PARTIAL') return 'warning';
  return 'neutral';
}
