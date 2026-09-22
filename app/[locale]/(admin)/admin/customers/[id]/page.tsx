import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { EntityActions } from '@/components/admin/entity-actions';
import { Card, CardContent } from '@/components/ui/card';
import { currentActorCan } from '@/lib/auth/current-actor';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { readAdminCustomerDetail } from '@/modules/admin-customers';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('customerDetail'), robots: { index: false, follow: false } };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('customer:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [detail, t, format] = await Promise.all([
    readAdminCustomerDetail(id),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  if (!detail) notFound();

  const { customer, addresses, recentOrders } = detail;
  const canSuspend = await currentActorCan('customer:suspend');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-customer-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{customer.fullName ?? 'Unnamed customer'}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {customer.phone ?? '—'} · {customer.email ?? '—'}
          </p>
        </div>
        <Badge variant={statusVariant(customer.status)}>{customer.status}</Badge>
      </div>

      <EntityActions
        resource="customer"
        id={customer.id}
        status={customer.status}
        allowed={canSuspend}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4 text-sm">
            <p className="text-muted-foreground text-xs">
              {locale === 'hi' ? 'कुल ऑर्डर' : 'Total orders'}
            </p>
            <p className="mt-2 text-2xl font-semibold">{customer.totalOrders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-sm">
            <p className="text-muted-foreground text-xs">Lifetime value</p>
            <p className="mt-2 text-2xl font-semibold">
              {format.number(Number(customer.lifetimeValuePaise) / 100, {
                style: 'currency',
                currency: 'INR',
              })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-sm">
            <p className="text-muted-foreground text-xs">
              {locale === 'hi' ? 'अंतिम लॉगिन' : 'Last login'}
            </p>
            <p className="mt-2 font-medium">
              {customer.lastLoginAt
                ? format.dateTime(customer.lastLoginAt, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4 text-sm">
            <h2 className="font-semibold">{locale === 'hi' ? 'खाता' : 'Account'}</h2>
            <dl className="mt-3 grid gap-2">
              <Row label="Preferred locale" value={customer.preferredLocale} />
              <Row label="Acquisition source" value={customer.acquisitionSource ?? '—'} />
              <Row label="Referral code" value={customer.referralCode ?? '—'} />
              <Row label="Phone verified" value={customer.phoneVerifiedAt ? 'YES' : 'NO'} />
              <Row
                label="Joined"
                value={format.dateTime(customer.createdAt, { dateStyle: 'medium' })}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 text-sm">
            <h2 className="font-semibold">
              {locale === 'hi' ? 'सहेजे गए पते' : 'Saved addresses'}
            </h2>
            {addresses.length === 0 ? (
              <p className="text-muted-foreground mt-3">No saved addresses.</p>
            ) : (
              <div className="mt-3 grid gap-3">
                {addresses.map((address) => (
                  <div key={address.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{address.label ?? address.addressType}</p>
                      {address.isDefault ? <Badge variant="success">DEFAULT</Badge> : null}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {[address.line1, address.line2, address.city, address.state, address.pincode]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold">{locale === 'hi' ? 'हाल के ऑर्डर' : 'Recent orders'}</h2>
          {recentOrders.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">No orders yet.</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-lg border">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-muted/50 text-muted-foreground text-xs">
                    <tr>
                      <th className="px-4 py-3 font-medium">Order</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Total</th>
                      <th className="px-4 py-3 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recentOrders.map((order) => (
                      <tr key={order.id}>
                        <td className="px-4 py-3 font-medium">{order.orderNumber}</td>
                        <td className="px-4 py-3">{order.status.replaceAll('_', ' ')}</td>
                        <td className="px-4 py-3">
                          {format.number(order.totalAmountPaise / 100, {
                            style: 'currency',
                            currency: 'INR',
                          })}
                        </td>
                        <td className="text-muted-foreground px-4 py-3 text-xs">
                          {format.dateTime(order.createdAt, {
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-sm">
          <h2 className="font-semibold">{t('customerDetail')}</h2>
          <p className="text-muted-foreground mt-2">
            {locale === 'hi'
              ? 'यह admin view operational support के लिए जरूरी customer data तक सीमित है।'
              : 'This admin view is limited to customer data required for operational support.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function statusVariant(status: string): BadgeVariant {
  if (status === 'ACTIVE') return 'success';
  if (status === 'BLOCKED' || status === 'SUSPENDED') return 'danger';
  return 'neutral';
}
