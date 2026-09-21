import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Card, CardContent } from '@/components/ui/card';
import { checkVendorPage } from '@/lib/auth/vendor-page';
import { listVendorNotifications } from '@/modules/vendor-operations';

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
  return { title: t('notifications'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('vendorNav');
  const access = await checkVendorPage('product:list');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;
  const rows = await listVendorNotifications(access.vendorId);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('notifications')}</h1>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">No notifications yet.</CardContent>
        </Card>
      ) : (
        rows.map((row) => (
          <Card key={row.id}>
            <CardContent className="p-4">
              <div className="flex justify-between gap-3">
                <p className="font-medium">{row.title ?? row.channel}</p>
                <span className="text-muted-foreground text-xs">{row.status}</span>
              </div>
              <p className="mt-2 text-sm">{row.body}</p>
              <p className="text-muted-foreground mt-2 text-xs">{row.createdAt.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
