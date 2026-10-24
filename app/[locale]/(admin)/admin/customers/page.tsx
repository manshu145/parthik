import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminCustomers } from '@/modules/admin-customers';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('customers'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('customer:list');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t, format] = await Promise.all([
    listAdminCustomers(),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  const active = rows.filter((row) => row.status === 'ACTIVE').length;
  const totalLtvPaise = rows.reduce((total, row) => total + Number(row.lifetimeValuePaise), 0);
  const totalOrders = rows.reduce((total, row) => total + row.totalOrders, 0);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-customers">
      <div>
        <h1 className="text-xl font-semibold">{t('customers')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'Customer accounts, order activity और lifetime value की operational view।'
            : 'Operational view of customer accounts, order activity and lifetime value.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label={locale === 'hi' ? 'सक्रिय ग्राहक' : 'Active customers'} value={active} />
        <Metric label={locale === 'hi' ? 'कुल ऑर्डर' : 'Total orders'} value={totalOrders} />
        <Metric
          label={locale === 'hi' ? 'कुल lifetime value' : 'Total lifetime value'}
          value={format.number(totalLtvPaise / 100, { style: 'currency', currency: 'INR' })}
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'अभी कोई customer profile नहीं है।' : 'No customer profiles yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Orders</th>
                  <th className="px-4 py-3 font-medium">LTV</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Last login</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/${locale}/admin/customers/${row.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {row.fullName ?? 'Unnamed customer'}
                      </Link>
                      <p className="text-muted-foreground mt-1 text-xs">{row.preferredLocale}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p>{row.phone ?? '—'}</p>
                      <p className="text-muted-foreground mt-1 text-xs">{row.email ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                    </td>
                    <td className="px-4 py-3">{row.totalOrders}</td>
                    <td className="px-4 py-3">
                      {format.number(Number(row.lifetimeValuePaise) / 100, {
                        style: 'currency',
                        currency: 'INR',
                      })}
                    </td>
                    <td className="px-4 py-3">{row.acquisitionSource ?? '—'}</td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {row.lastLoginAt
                        ? format.dateTime(row.lastLoginAt, {
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

function statusVariant(status: string): BadgeVariant {
  if (status === 'ACTIVE') return 'success';
  if (status === 'BLOCKED' || status === 'SUSPENDED') return 'danger';
  return 'neutral';
}
