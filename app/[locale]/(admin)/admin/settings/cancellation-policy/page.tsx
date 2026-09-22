import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { CONSERVATIVE_CANCELLATION_POLICIES } from '@/modules/order';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('cancellationPolicy'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('setting:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const t = await getTranslations('adminNav');
  const rows = [...CONSERVATIVE_CANCELLATION_POLICIES];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-cancellation-policy">
      <div>
        <h1 className="text-xl font-semibold">{t('cancellationPolicy')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          These are the exact conservative rules currently used by the order cancellation engine.
          Commercial values in D-19a are unresolved, so this screen is intentionally read-only
          instead of inventing refund windows or percentages.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <Badge variant="warning">D-19a BLOCKED</Badge>
          <span>
            Missing rules fail closed. A cancellation with no matching approved policy is refused
            and can be handled through support.
          </span>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">From status</th>
              <th className="px-4 py-3">Payment scope</th>
              <th className="px-4 py-3">Allowed</th>
              <th className="px-4 py-3">Window</th>
              <th className="px-4 py-3">Refund</th>
              <th className="px-4 py-3">Delivery fee</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Restock</th>
              <th className="px-4 py-3">Driver comp.</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, index) => (
              <tr
                key={
                  row.actorRole +
                  '-' +
                  row.fromStatus +
                  '-' +
                  row.paymentMethodScope +
                  '-' +
                  index
                }
              >
                <td className="px-4 py-3 font-medium">{row.actorRole}</td>
                <td className="px-4 py-3">{row.fromStatus.replaceAll('_', ' ')}</td>
                <td className="px-4 py-3">{row.paymentMethodScope}</td>
                <td className="px-4 py-3">
                  <Badge variant={row.isAllowed ? 'success' : 'danger'}>
                    {row.isAllowed ? 'YES' : 'NO'}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {row.windowMinutes === null ? 'No time limit' : row.windowMinutes + ' min'}
                </td>
                <td className="px-4 py-3">{row.refundPercent}% items</td>
                <td className="px-4 py-3">{row.refundDeliveryFee ? 'Refunded' : 'Not refunded'}</td>
                <td className="px-4 py-3">{row.requiresReason ? 'Required' : 'Optional'}</td>
                <td className="px-4 py-3">{row.restock ? 'YES' : 'NO'}</td>
                <td className="px-4 py-3">{row.compensateDriver ? 'YES' : 'NO'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Card>
        <CardContent className="p-4 text-sm">
          <p className="font-medium">Why editing is locked</p>
          <p className="text-muted-foreground mt-1">
            Windows, partial refund percentages, restocking exceptions and driver compensation are
            business-policy decisions. Once D-19a is approved, the engine can be switched to the
            database policy table and this page can safely become an editor without changing the
            order state machine.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
