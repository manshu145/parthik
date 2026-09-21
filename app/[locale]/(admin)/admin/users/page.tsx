import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { AdminUserManagement } from '@/components/admin/access-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminUserManagement } from '@/modules/admin-access';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('users'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('admin_user:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [rows, t] = await Promise.all([
    listAdminUserManagement(),
    getTranslations('adminNav'),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-users">
      <div>
        <h1 className="text-xl font-semibold">{t('users')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Promote verified accounts to admin roles, suspend access and revoke active sessions.
          New accounts are created only through verified authentication.
        </p>
      </div>
      <AdminUserManagement
        users={rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
