import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminVendors } from '@/modules/admin-people';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('vendors'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('vendor:list');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [vendors, t, format] = await Promise.all([
    listAdminVendors(),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-vendors">
      <div>
        <h1 className="text-xl font-semibold">{t('vendors')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi' ? 'Vendor applications, approval status और contact details.' : 'Vendor applications, approval status and contact details.'}
        </p>
      </div>

      {vendors.length === 0 ? (
        <Card><CardContent className="p-4 text-sm">{locale === 'hi' ? 'अभी कोई vendor नहीं है।' : 'No vendors yet.'}</CardContent></Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Vendor</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'स्थिति' : 'Status'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'संपर्क' : 'Contact'}</th>
                  <th className="px-4 py-3 font-medium">{locale === 'hi' ? 'बनाया गया' : 'Created'}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {vendors.map((vendor) => (
                  <tr key={vendor.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link href={`/admin/vendors/${vendor.id}`} className="font-medium hover:underline">{vendor.businessName}</Link>
                      {vendor.legalName && <p className="text-muted-foreground mt-1 text-xs">{vendor.legalName}</p>}
                    </td>
                    <td className="px-4 py-3"><Badge variant={vendorStatusVariant(vendor.status)}>{vendor.status.replaceAll('_', ' ')}</Badge></td>
                    <td className="px-4 py-3">
                      <p>{vendor.contactPhone ?? '—'}</p>
                      <p className="text-muted-foreground mt-1 text-xs">{vendor.contactEmail ?? '—'}</p>
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">{format.dateTime(vendor.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</td>
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

function vendorStatusVariant(status: string): BadgeVariant {
  if (status === 'APPROVED') return 'success';
  if (status === 'REJECTED' || status === 'SUSPENDED') return 'danger';
  return 'warning';
}
