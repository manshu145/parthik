import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { PayoutActions } from '@/components/admin/payout-actions';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminPayoutBatches } from '@/modules/admin-payments';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('payouts'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('payout:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t, format] = await Promise.all([
    listAdminPayoutBatches(),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  const draft = rows.filter((row) => row.status === 'DRAFT').length;
  const pendingPaise = rows
    .filter((row) => row.status !== 'PAID')
    .reduce((total, row) => total + row.netAmountPaise, 0);
  const paidPaise = rows
    .filter((row) => row.status === 'PAID')
    .reduce((total, row) => total + row.netAmountPaise, 0);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-payouts">
      <div>
        <h1 className="text-xl font-semibold">{t('payouts')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Vendor और driver payout batches की reporting. D-15 तय होने तक यहां से कोई automated money movement नहीं होता।'
            : 'Vendor and driver payout batch reporting. Automated money movement remains disabled until D-15 is decided.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label={locale === 'hi' ? 'ड्राफ्ट बैच' : 'Draft batches'} value={draft} />
        <Metric
          label={locale === 'hi' ? 'अवैतनिक नेट' : 'Unpaid net'}
          value={format.number(pendingPaise / 100, { style: 'currency', currency: 'INR' })}
        />
        <Metric
          label={locale === 'hi' ? 'भुगतान किया गया' : 'Paid net'}
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
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Payee</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium">Gross</th>
                  <th className="px-4 py-3 font-medium">Deductions</th>
                  <th className="px-4 py-3 font-medium">Net</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.payeeType}</p>
                      <p className="text-muted-foreground mt-1 max-w-48 truncate text-xs">
                        {row.payeeId}
                      </p>
                    </td>
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
                      <Badge variant={payoutStatusVariant(row.status)}>{row.status}</Badge>
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {row.referenceNumber ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <PayoutActions payoutId={row.id} status={row.status} />
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

function payoutStatusVariant(status: string): BadgeVariant {
  if (status === 'PAID') return 'success';
  if (status === 'FAILED' || status === 'REJECTED') return 'danger';
  if (status === 'DRAFT' || status === 'PENDING' || status === 'APPROVED') return 'warning';
  return 'neutral';
}
