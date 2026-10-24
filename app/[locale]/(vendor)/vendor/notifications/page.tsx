import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { VendorNotificationList } from '@/components/vendor/vendor-notification-list';
import { checkVendorPage } from '@/lib/auth/vendor-page';
import { listVendorNotifications } from '@/modules/vendor-operations';

export const dynamic = 'force-dynamic';

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
  const access = await checkVendorPage('notification:view');
  if (access.status !== 'ok' || !access.vendorId) return <AccessDenied decision={access} />;
  const rows = await listVendorNotifications(access.vendorId, access.actor.userId);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('notifications')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'आपकी notifications और उनके पढ़े जाने की स्थिति।'
            : 'Your notifications and their read status.'}
        </p>
      </div>
      <VendorNotificationList
        locale={locale}
        rows={rows.map((row) => ({
          ...row,
          readAt: row.readAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
