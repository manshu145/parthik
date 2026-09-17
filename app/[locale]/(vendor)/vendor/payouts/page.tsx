import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkVendorPage } from '@/lib/auth/vendor-page';
import { listVendorPayoutBatches } from '@/modules/vendor-operations';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });
  return { title: t('payouts'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Vendor payout visibility is read-only operational reporting. Vendor owners hold
  // analytics:view; staff do not, so bank/settlement reporting stays owner-only.
  const access = await checkVendorPage('analytics:view');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;

  const [rows, t, format] = await Promise.all([
    listVendorPayoutBatches(access.vendorId),
    getTranslations('vendorNav'),
    getFormatter(),
  ]);

  const paidPaise = rows
    .filter((row) => row.status === 'PAID')
    .reduce((sum, row) => sum + row.netAmountPaise, 0);
  const openPaise = rows
    .filter((row) => row.status !== 'PAID' && row.status !== 'FAILED')
    .reduce((sum, row) => sum + row.netAmountPaise, 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="vendor-payouts">
      <div>
        <h1 className="text-xl font-semibold">{t('payouts')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'आपके vendor account के payout batch records। यहां से कोई bank transfer trigger नहीं होता।'
            : 'Payout batch records for your vendor account. This screen cannot trigger a bank transfer.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Batches" value={rows.length} />
        <Metric
          label="Open net"
          value={format.number(openPaise / 100, { style: 'currency', currency: 'INR' })}
        />
        <Metric
          label="Paid net"
          value={format.number(paidPaise / 100, { style: 'currency', currency: 'INR' })}
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'अभी कोई payout batch नहीं है।' : 'No payout batches yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium">Gross</th>
                  <th className="px-4 py-3 font-medium">Deductions</th>
                  <th className="px-4 py-3 font-medium">Net</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-xs">
                      {row.periodStart} → {row.periodEnd}
                    </td>
                    <td className="px-4 py-3">
                      {format.number(row.grossAmountPaise / 100, {
                        style: 'currency',
                        currency: 'INR',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      {format.number(row.deductionsPaise / 100, {
                        style: 'currency',
                        currency: 'INR',
                      })}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {format.number(row.netAmountPaise / 100, {
                        style: 'currency',
                        currency: 'INR',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={row.status === 'PAID' ? 'success' : row.status === 'FAILED' ? 'danger' : 'warning'}>
                        {row.status}
                      </Badge>
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {row.referenceNumber ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        {locale === 'hi'
          ? 'D-15 final होने तक payout calculation/reporting available है, automated settlement नहीं।'
          : 'Until D-15 is final, payout calculation/reporting is available but automated settlement is not.'}
      </p>
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
