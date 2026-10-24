import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { NotificationManagement } from '@/components/admin/notification-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminNotifications } from '@/modules/admin-notifications';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('notifications'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('notification:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t] = await Promise.all([listAdminNotifications(), getTranslations('adminNav')]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-notifications">
      <div>
        <h1 className="text-xl font-semibold">{t('notifications')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Send PUSH or IN_APP notifications and inspect delivery failures. Unsupported channels are
          intentionally unavailable in V1.
        </p>
      </div>
      <NotificationManagement
        rows={rows.map((row) => ({
          ...row,
          sentAt: row.sentAt?.toISOString() ?? null,
          deliveredAt: row.deliveredAt?.toISOString() ?? null,
          readAt: row.readAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
