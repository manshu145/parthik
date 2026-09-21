import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Card, CardContent } from '@/components/ui/card';
import { checkVendorPage } from '@/lib/auth/vendor-page';
import { listVendorCoupons } from '@/modules/vendor-operations';

export const dynamic = 'force-dynamic';

/**
 * Route is live, screen is pending. See components/layout/dashboard-page.tsx for
 * why a shared placeholder is the honest choice here.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vendorNav' });

  // Every dashboard route is noindex (docs/ROUTES.md §6–§8).
  return { title: t('coupons'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('vendorNav');
  const access = await checkVendorPage('product:list');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;
  const rows = await listVendorCoupons(access.vendorId);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4"><h1 className="text-xl font-semibold">{t('coupons')}</h1>{rows.length === 0 ? <Card><CardContent className="p-4 text-sm">No coupons currently apply to this vendor.</CardContent></Card> : <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr><th className="p-3">Code</th><th className="p-3">Type</th><th className="p-3">Value</th><th className="p-3">Minimum cart</th><th className="p-3">Uses</th><th className="p-3">Status</th></tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={row.id}><td className="p-3 font-medium">{row.code}</td><td className="p-3">{row.couponType}</td><td className="p-3">{row.discountValue}</td><td className="p-3">₹{(row.minCartPaise / 100).toFixed(2)}</td><td className="p-3">{row.usedCount}{row.usageLimitTotal ? ` / ${row.usageLimitTotal}` : ''}</td><td className="p-3">{row.isActive ? 'Active' : 'Inactive'}</td></tr>)}</tbody></table></div>}</div>
  );
}
