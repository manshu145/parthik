import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminPayments } from '@/modules/admin-payments';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('payments'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('payment:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t, format] = await Promise.all([
    listAdminPayments(),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  const paidPaise = rows
    .filter((row) => row.status === 'PAID')
    .reduce((total, row) => total + row.amountPaise, 0);
  const pending = rows.filter((row) => row.status === 'CREATED' || row.status === 'PENDING').length;
  const failed = rows.filter((row) => row.status === 'FAILED').length;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-payments">
      <div>
        <h1 className="text-xl font-semibold">{t('payments')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Gateway और COD payment records, failures और reconciliation status.'
            : 'Gateway and COD payment records, failures and reconciliation status.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label={locale === 'hi' ? 'Paid volume' : 'Paid volume'}
          value={format.number(paidPaise / 100, { style: 'currency', currency: 'INR' })}
        />
        <Metric label={locale === 'hi' ? 'लंबित' : 'Pending'} value={pending} />
        <Metric label={locale === 'hi' ? 'असफल' : 'Failed'} value={failed} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'अभी कोई payment record नहीं है।' : 'No payment records yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Reconciled</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{row.orderNumber}</td>
                    <td className="px-4 py-3">
                      <p>{row.provider}</p>
                      {row.providerPaymentId ? (
                        <p className="text-muted-foreground mt-1 max-w-56 truncate text-xs">
                          {row.providerPaymentId}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{row.method.replaceAll('_', ' ')}</td>
                    <td className="px-4 py-3">
                      <Badge variant={paymentStatusVariant(row.status)}>{row.status}</Badge>
                      {row.failureMessage ? (
                        <p className="text-danger mt-1 max-w-64 text-xs">{row.failureMessage}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {format.number(row.amountPaise / 100, {
                        style: 'currency',
                        currency: row.currency,
                      })}
                    </td>
                    <td className="px-4 py-3">
                      {row.reconciledAt ? (
                        <Badge variant="success">YES</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {format.dateTime(row.createdAt, {
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

function paymentStatusVariant(status: string): BadgeVariant {
  if (status === 'PAID') return 'success';
  if (status === 'FAILED' || status === 'REFUNDED') return 'danger';
  if (status === 'CREATED' || status === 'PENDING' || status === 'AUTHORIZED') return 'warning';
  return 'neutral';
}
