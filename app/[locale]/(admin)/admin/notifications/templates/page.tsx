import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { NotificationTemplateManagement } from '@/components/admin/notification-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminNotificationTemplates } from '@/modules/admin-notifications';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('templates'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('template:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t] = await Promise.all([
    listAdminNotificationTemplates(),
    getTranslations('adminNav'),
  ]);

  return (
    <div
      className="mx-auto flex max-w-7xl flex-col gap-4"
      data-testid="admin-notification-templates"
    >
      <div>
        <h1 className="text-xl font-semibold">{t('templates')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Versioned English/Hindi PUSH and IN_APP templates. Email, SMS and WhatsApp remain
          reserved until their provider decisions are enabled.
        </p>
      </div>
      <NotificationTemplateManagement
        rows={rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))}
      />
    </div>
  );
}
