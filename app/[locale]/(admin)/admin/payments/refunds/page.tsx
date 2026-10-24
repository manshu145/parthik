import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminRefunds } from '@/modules/admin-payments';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('refunds'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('refund:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t, format] = await Promise.all([
    listAdminRefunds(),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  const initiated = rows.filter((row) => row.status === 'INITIATED').length;
  const completedPaise = rows
    .filter((row) => row.status === 'COMPLETED')
    .reduce((total, row) => total + row.amountPaise, 0);
  const failed = rows.filter((row) => row.status === 'FAILED').length;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-refunds">
      <div>
        <h1 className="text-xl font-semibold">{t('refunds')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Refund records और provider/manual completion status. Policy values D-19a तय होने तक यहां नई policy invent नहीं की जाती।'
            : 'Refund records and provider/manual completion status. No new policy values are invented while D-19a is unresolved.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label={locale === 'hi' ? 'आरंभ किए गए' : 'Initiated'} value={initiated} />
        <Metric
          label={locale === 'hi' ? 'पूर्ण राशि' : 'Completed amount'}
          value={format.number(completedPaise / 100, { style: 'currency', currency: 'INR' })}
        />
        <Metric label={locale === 'hi' ? 'असफल' : 'Failed'} value={failed} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'अभी कोई refund record नहीं है।' : 'No refund records yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Initiated</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{row.orderNumber}</td>
                    <td className="px-4 py-3">{row.refundType.replaceAll('_', ' ')}</td>
                    <td className="px-4 py-3">
                      <Badge variant={refundStatusVariant(row.status)}>{row.status}</Badge>
                      {row.failureReason ? (
                        <p className="text-danger mt-1 max-w-64 text-xs">{row.failureReason}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {format.number(row.amountPaise / 100, {
                        style: 'currency',
                        currency: 'INR',
                      })}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">{row.reason ?? '—'}</td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {format.dateTime(row.initiatedAt, {
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

function refundStatusVariant(status: string): BadgeVariant {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED' || status === 'REJECTED') return 'danger';
  if (status === 'INITIATED' || status === 'APPROVED' || status === 'PROCESSING') return 'warning';
  return 'neutral';
}
